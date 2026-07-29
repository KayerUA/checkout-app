import { prisma } from "@/lib/db";
import { getBankStatementProvider } from "@/lib/bank";
import { buildBankReconciliationCandidates, ensureB2BOrderRecord } from "@/lib/reconciliation/candidates";
import { matchBankTransaction } from "@/lib/reconciliation/matcher";
import { liqPayAcquiringSourceIdentifier } from "@/lib/reconciliation/online-acquiring";
import { B2B_TAGS } from "@/lib/b2b/constants";
import { getOrderAttributes, normalizeB2BAttributes } from "@/lib/b2b/attributes";
import { writeAutomationLog } from "@/lib/b2b/log";
import { createPostPaymentDocuments } from "@/lib/b2b/orders";
import { notifyDiloshopOrderReady } from "@/lib/accounting/diloshop";
import {
  appendOrderNote,
  getShopifyOrder,
  markOrderPaidByBankTransfer,
  setOrderMetafields,
  updateOrderTags,
} from "@/lib/shopify/b2b-admin";
import type { BankTransaction } from "@/lib/bank/types";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";
import type { B2BOrder, Prisma } from "@prisma/client";
import { notifyExternalOpsAlert } from "@/lib/telegram/ops-alerts";

export type BankPaymentProgressStatus =
  | "PARTIALLY_PAID"
  | "PAID"
  | "PAID_WITH_OVERPAYMENT";

export function calculateBankPaymentProgress(expectedAmount: number, paidAmount: number) {
  const expectedCents = Math.max(0, Math.round(expectedAmount * 100));
  const paidCents = Math.max(0, Math.round(paidAmount * 100));
  const remainingCents = Math.max(0, expectedCents - paidCents);
  const overpaymentCents = Math.max(0, paidCents - expectedCents);
  const status: BankPaymentProgressStatus =
    paidCents < expectedCents
      ? "PARTIALLY_PAID"
      : paidCents === expectedCents
        ? "PAID"
        : "PAID_WITH_OVERPAYMENT";
  return {
    status,
    expectedAmount: expectedCents / 100,
    paidAmount: paidCents / 100,
    remainingAmount: remainingCents / 100,
    overpaymentAmount: overpaymentCents / 100,
    isFullyPaid: paidCents >= expectedCents,
  };
}

export function calculateShopifyPaymentPresentation(input: {
  paidAmount: number;
  businessOverpaymentAmount: number;
  shopifyRecordedAmount: number;
}) {
  const paidCents = Math.max(0, Math.round(input.paidAmount * 100));
  const recordedCents = Math.max(0, Math.round(input.shopifyRecordedAmount * 100));
  const businessOverpaymentCents = Math.max(
    0,
    Math.round(input.businessOverpaymentAmount * 100)
  );
  const differenceCents = paidCents - recordedCents;
  // A Shopify transaction snapshot may lag an orders/paid webhook or represent
  // a different gateway. It is useful audit information, but it is not money
  // the buyer overpaid. Only the cumulative bank amount above the invoice can
  // produce an overpayment state.
  const overpaymentCents = businessOverpaymentCents;
  return {
    status: (overpaymentCents > 0 ? "PAID_WITH_OVERPAYMENT" : "PAID") as
      | "PAID"
      | "PAID_WITH_OVERPAYMENT",
    shopifyRecordedAmount: recordedCents / 100,
    bankVsShopifyDifferenceAmount: differenceCents / 100,
    overpaymentAmount: overpaymentCents / 100,
  };
}

function bankPaymentReconcileNote(input: {
  transactionId: string;
  currency: string;
  paidAmount: number;
  shopifyRecordedAmount: number;
  differenceAmount: number;
}) {
  const sign = input.differenceAmount >= 0 ? "+" : "";
  return [
    `Банківська звірка [${input.transactionId}]:`,
    `отримано ${input.paidAmount.toFixed(2)} ${input.currency};`,
    `Shopify зафіксував ${input.shopifyRecordedAmount.toFixed(2)} ${input.currency};`,
    `різниця ${sign}${input.differenceAmount.toFixed(2)} ${input.currency}.`,
    "Фактичну оплату звіряти за банківською транзакцією.",
  ].join(" ");
}

function paymentPayloadWithMatching(input: {
  rawPayload: unknown;
  matchingMethod: string;
  matchingConfidence: number;
  matchingDetails?: Record<string, unknown>;
}) {
  const raw = input.rawPayload;
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : { bank_payload: raw };
  return {
    ...base,
    _reconciliation: {
      matching_method: input.matchingMethod,
      matching_confidence: input.matchingConfidence,
      ...(input.matchingDetails ? { matching_details: input.matchingDetails } : {}),
    },
  } as Prisma.InputJsonValue;
}

type ManualBankAllocation = { shopifyOrderId: string; amount: number };

function manualAllocations(rawPayload: unknown): ManualBankAllocation[] {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return [];
  const reconciliation = (rawPayload as Record<string, unknown>)._reconciliation;
  if (!reconciliation || typeof reconciliation !== "object" || Array.isArray(reconciliation)) return [];
  const values = reconciliation as Record<string, unknown>;
  const matchingDetails = values.matching_details;
  const allocations = values.manual_allocations ?? (
    matchingDetails && typeof matchingDetails === "object" && !Array.isArray(matchingDetails)
      ? (matchingDetails as Record<string, unknown>).manual_allocations
      : undefined
  );
  if (!Array.isArray(allocations)) return [];
  return allocations.flatMap((allocation) => {
    if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) return [];
    const value = allocation as Record<string, unknown>;
    const shopifyOrderId = String(value.shopifyOrderId ?? "");
    const amount = Number(value.amount);
    return shopifyOrderId && Number.isFinite(amount) && amount > 0
      ? [{ shopifyOrderId, amount: Number(amount.toFixed(2)) }]
      : [];
  });
}

async function recordedBankAmountForOrder(shopifyOrderId: string, currency: string) {
  const payments = await prisma.bankPayment.findMany({
    where: { status: "MATCHED", currency },
    select: { matchedShopifyOrderId: true, amount: true, rawPayload: true },
  });
  return Number(
    payments.reduce((total, payment) => {
      const allocated = manualAllocations(payment.rawPayload).find(
        (allocation) => allocation.shopifyOrderId === shopifyOrderId
      );
      if (allocated) return total + allocated.amount;
      return payment.matchedShopifyOrderId === shopifyOrderId
        ? total + Number(payment.amount)
        : total;
    }, 0).toFixed(2)
  );
}

async function saveBankTransaction(tx: BankTransaction) {
  return prisma.bankPayment.upsert({
    where: { transactionId: tx.transaction_id },
    create: {
      provider: tx.provider,
      bankAccountIban: tx.iban_to,
      transactionId: tx.transaction_id,
      transactionDate: tx.transaction_date,
      payerName: tx.payer_name,
      payerTaxId: tx.payer_tax_id,
      amount: tx.amount,
      currency: tx.currency,
      paymentDescription: tx.payment_description,
      status: "NEW",
      rawPayload: tx.raw_payload as Prisma.InputJsonValue,
    },
    update: {},
  });
}

async function clearStaleAmbiguousOrderReview(input: {
  transactionId: string;
  staleOrderId: string | null;
  staleMatchingMethod: string | null;
}) {
  // Versions before 826ebb7 attached an ambiguous payment to the first order
  // returned by the matcher. On its next reconciliation, safely undo that
  // synthetic assignment unless another review still points at this order.
  if (
    !input.staleOrderId ||
    !input.staleMatchingMethod?.startsWith("ambiguous_")
  ) {
    return;
  }

  const anotherReview = await prisma.bankPayment.count({
    where: {
      matchedShopifyOrderId: input.staleOrderId,
      status: "NEEDS_REVIEW",
      transactionId: { not: input.transactionId },
    },
  });
  if (anotherReview > 0) return;

  const order = await prisma.b2BOrder.findUnique({
    where: { shopifyOrderId: input.staleOrderId },
    select: { shopifyOrderId: true, shopDomain: true, status: true },
  });
  if (!order || order.status !== "NEEDS_REVIEW") return;

  await prisma.b2BOrder.update({
    where: { shopifyOrderId: order.shopifyOrderId },
    data: { status: "WAITING_BANK_PAYMENT" },
  });
  await updateOrderTags({
    shopDomain: order.shopDomain,
    orderId: order.shopifyOrderId,
    remove: [B2B_TAGS.needsPaymentReview],
  });
}

async function reconcileLiqPayAcquiringTransaction(tx: BankTransaction) {
  const sourceIdentifier = liqPayAcquiringSourceIdentifier(tx);
  if (!sourceIdentifier) return null;

  const session = await prisma.checkoutSession.findUnique({
    where: { sourceIdentifier },
    select: {
      id: true,
      status: true,
      orderLink: { select: { shopifyOrderGid: true, shopifyOrderName: true } },
    },
  });

  if (session?.orderLink?.shopifyOrderGid) {
    await prisma.bankPayment.update({
      where: { transactionId: tx.transaction_id },
      data: {
        // Production DB constrains status to the legacy set. The matching
        // method carries the more precise "already settled online" meaning.
        status: "MATCHED",
        matchingMethod: "liqpay_soid_order_exists",
        matchedShopifyOrderId: session.orderLink.shopifyOrderGid.replace("gid://shopify/Order/", ""),
      },
    });
    return {
      transactionId: tx.transaction_id,
      status: "SKIPPED" as const,
      reason: "liqpay_online_payment_already_linked",
      shopifyOrderName: session.orderLink.shopifyOrderName,
    };
  }

  await prisma.bankPayment.update({
    where: { transactionId: tx.transaction_id },
    data: {
      status: "NEEDS_REVIEW",
      matchingMethod: session
        ? "liqpay_soid_checkout_without_order"
        : "liqpay_soid_checkout_missing",
    },
  });
  await notifyExternalOpsAlert({
    source: "bank",
    eventType: `liqpay_checkout_review_${tx.transaction_id.slice(-8)}`,
    severity: "warning",
    message: [
      `LiqPay acquiring потребує перевірки: ${tx.amount.toFixed(2)} ${tx.currency}`,
      `SOID: ${sourceIdentifier}`,
      session
        ? `Checkout: ${session.id} · Shopify-заказ відсутній`
        : "Checkout за SOID не знайдено",
      `Transaction: …${tx.transaction_id.slice(-12)}`,
    ].join(" · "),
    metadata: { bankTransactionId: tx.transaction_id, sourceIdentifier },
    dedupeWindowHours: null,
  }).catch(() => {});
  return {
    transactionId: tx.transaction_id,
    status: "NEEDS_REVIEW" as const,
    reason: session ? "liqpay_checkout_without_order" : "liqpay_checkout_missing",
  };
}

async function syncOrderLinkPaymentStatus(shopifyOrderId: string, orderStatus: string) {
  await prisma.orderLink.updateMany({
    where: {
      OR: [
        { shopifyOrderGid: orderGid(shopifyOrderId) },
        { shopifyOrderGid: { endsWith: `/${shopifyOrderId}` } },
      ],
    },
    data: { orderStatus },
  });
}

function orderGid(orderId: string) {
  return orderId.startsWith("gid://shopify/Order/") ? orderId : `gid://shopify/Order/${orderId}`;
}

async function attachBankPaymentAndCalculateProgress(input: {
  tx: BankTransaction;
  order: B2BOrder;
  expectedAmount: number;
  confidence: number;
  matchingMethod: string;
}) {
  return prisma.$transaction(async (db) => {
    const existing = await db.bankPayment.findUnique({
      where: { transactionId: input.tx.transaction_id },
      select: { matchedShopifyOrderId: true },
    });
    if (
      existing?.matchedShopifyOrderId &&
      existing.matchedShopifyOrderId !== input.order.shopifyOrderId
    ) {
      throw new Error("Bank transaction is already matched to another order");
    }

    await db.bankPayment.update({
      where: { transactionId: input.tx.transaction_id },
      data: {
        status: "MATCHED",
        matchedShopifyOrderId: input.order.shopifyOrderId,
        matchingMethod: input.matchingMethod,
        matchConfidence: input.confidence,
        rawPayload: paymentPayloadWithMatching({
          rawPayload: input.tx.raw_payload,
          matchingMethod: input.matchingMethod,
          matchingConfidence: input.confidence,
        }),
      },
    });

    const aggregate = await db.bankPayment.aggregate({
      where: {
        matchedShopifyOrderId: input.order.shopifyOrderId,
        status: "MATCHED",
        currency: input.tx.currency,
      },
      _sum: { amount: true },
    });
    // A manually confirmed transfer may be allocated across several orders.
    // These source records have no single matched order, so add their shares
    // explicitly while staying inside this transaction.
    const splitSources = await db.bankPayment.findMany({
      where: { matchedShopifyOrderId: null, status: "MATCHED", currency: input.tx.currency },
      select: { rawPayload: true },
    });
    const manualAmount = splitSources.reduce(
      (total, source) => total + (manualAllocations(source.rawPayload).find(
        (allocation) => allocation.shopifyOrderId === input.order.shopifyOrderId
      )?.amount ?? 0),
      0
    );
    const paidAmount = Number((Number(aggregate._sum.amount ?? 0) + manualAmount).toFixed(2));
    const progress = calculateBankPaymentProgress(
      input.expectedAmount,
      paidAmount
    );

    const authoritativeReference = [
      "tax_id_and_order_number",
      "tax_id_and_numeric_order_number",
    ].includes(input.matchingMethod);
    const settledProgress = authoritativeReference
      ? {
          ...progress,
          status: "PAID" as const,
          remainingAmount: 0,
          overpaymentAmount: 0,
          isFullyPaid: true,
          invoiceDifferenceAmount: Number((progress.paidAmount - progress.expectedAmount).toFixed(2)),
        }
      : { ...progress, invoiceDifferenceAmount: 0 };

    await db.b2BOrder.update({
      where: { shopifyOrderId: input.order.shopifyOrderId },
      data: {
        orderTotalAmount: settledProgress.expectedAmount,
        expectedAmount: settledProgress.expectedAmount,
        paidAmount: settledProgress.paidAmount,
        remainingAmount: settledProgress.remainingAmount,
        paymentStatus: settledProgress.status,
        status: settledProgress.isFullyPaid ? "PAYMENT_MATCHED" : "PARTIALLY_PAID",
      },
    });
    return settledProgress;
  }, { isolationLevel: "Serializable" });
}

/** Apply a human-confirmed multi-order bank transfer. A tolerance is recorded
 * explicitly; it is never treated as an unlabelled overpayment. */
export async function applyManualBankPaymentProposal(input: {
  bankPaymentId: string;
  toleranceUah?: number;
}) {
  const payment = await prisma.bankPayment.findUnique({ where: { id: input.bankPaymentId } });
  if (!payment) throw new Error("Банківський платіж не знайдено.");
  if (payment.matchingMethod === "manual_multi_order_allocation") {
    return { alreadyApplied: true, transactionId: payment.transactionId };
  }
  if (payment.status !== "NEEDS_REVIEW") {
    throw new Error("Цей платіж уже не очікує ручного розподілу.");
  }
  const raw = payment.rawPayload as Record<string, unknown> | null;
  const reconciliation = raw?._reconciliation as Record<string, unknown> | undefined;
  const details = reconciliation?.matching_details as Record<string, unknown> | undefined;
  const proposed = Array.isArray(details?.candidates) ? details.candidates : [];
  const orderIds = proposed.flatMap((candidate) => {
    const id = candidate && typeof candidate === "object"
      ? String((candidate as Record<string, unknown>).shopifyOrderId ?? "")
      : "";
    return /^\d+$/.test(id) ? [id] : [];
  });
  if (orderIds.length < 2) throw new Error("Для платежу не збережено набір рахунків.");

  const { candidates, openOrders, invoiceByOrder } = await buildBankReconciliationCandidates();
  const selected = orderIds.map((id) => candidates.find((candidate) => candidate.shopifyOrderId === id));
  if (selected.some((candidate) => !candidate)) throw new Error("Один зі счетів уже не очікує оплату.");
  const rows = selected as NonNullable<(typeof selected)[number]>[];
  if (rows.some((candidate) => candidate.currency !== payment.currency)) {
    throw new Error("Валюта платежу та рахунків не збігається.");
  }
  const expectedAmount = Number(rows.reduce((sum, candidate) => sum + candidate.amount, 0).toFixed(2));
  const difference = Number((Number(payment.amount) - expectedAmount).toFixed(2));
  const tolerance = input.toleranceUah ?? 1;
  if (Math.abs(difference) > tolerance) {
    throw new Error(`Сума вибраних рахунків відрізняється на ${difference.toFixed(2)} UAH.`);
  }

  const allocations = rows.map((candidate) => ({
    shopifyOrderId: candidate.shopifyOrderId,
    amount: candidate.amount,
  }));
  await prisma.bankPayment.update({
    where: { id: payment.id },
    data: {
      status: "MATCHED",
      matchedShopifyOrderId: null,
      matchingMethod: "manual_multi_order_allocation",
      matchConfidence: 1,
      rawPayload: paymentPayloadWithMatching({
        rawPayload: payment.rawPayload,
        matchingMethod: "manual_multi_order_allocation",
        matchingConfidence: 1,
        matchingDetails: {
          manual_allocations: allocations,
          expectedAmount,
          paymentAmount: Number(payment.amount),
          roundingDifference: difference,
          toleranceUah: tolerance,
        },
      }),
    },
  });

  const tx: BankTransaction = {
    provider: payment.provider,
    transaction_id: payment.transactionId,
    transaction_date: payment.transactionDate,
    payer_name: payment.payerName ?? undefined,
    payer_tax_id: payment.payerTaxId ?? undefined,
    amount: Number(payment.amount),
    currency: payment.currency,
    payment_description: payment.paymentDescription ?? undefined,
    raw_payload: payment.rawPayload ?? {},
  };
  const results = [];
  for (const candidate of rows) {
    const order = openOrders.find((row) => row.shopifyOrderId === candidate.shopifyOrderId) ??
      await ensureB2BOrderRecord({ shopifyOrderId: candidate.shopifyOrderId });
    if (!order) throw new Error(`B2B запис для ${candidate.shopifyOrderName ?? candidate.shopifyOrderId} не знайдено.`);
    const progress = calculateBankPaymentProgress(
      candidate.amount,
      await recordedBankAmountForOrder(candidate.shopifyOrderId, payment.currency)
    );
    await prisma.b2BOrder.update({
      where: { shopifyOrderId: order.shopifyOrderId },
      data: {
        expectedAmount: progress.expectedAmount,
        paidAmount: progress.paidAmount,
        remainingAmount: progress.remainingAmount,
        paymentStatus: progress.status,
        status: progress.isFullyPaid ? "PAYMENT_MATCHED" : "PARTIALLY_PAID",
      },
    });
    if (!progress.isFullyPaid) {
      await applyPartialBankPaymentState({ tx, order, progress });
      results.push({ order: order.shopifyOrderName, status: progress.status });
      continue;
    }
    const shopifyPayment = await applyFullyPaidBankPaymentState({ tx, order, progress });
    await completeBankPaymentSideEffects({
      tx,
      order,
      invoiceNumber: invoiceByOrder.get(order.shopifyOrderId)?.number,
      progress,
      presentation: shopifyPayment.presentation,
    });
    results.push({ order: order.shopifyOrderName, status: shopifyPayment.presentation.status });
  }
  return { alreadyApplied: false, transactionId: payment.transactionId, expectedAmount, difference, results };
}

async function applyPartialBankPaymentState(input: {
  tx: BankTransaction;
  order: B2BOrder;
  progress: ReturnType<typeof calculateBankPaymentProgress>;
}) {
  await syncOrderLinkPaymentStatus(input.order.shopifyOrderId, "WAITING_BANK_PAYMENT");
  await updateOrderTags({
    shopDomain: input.order.shopDomain,
    orderId: input.order.shopifyOrderId,
    add: [B2B_TAGS.partiallyPaid, B2B_TAGS.waitingIbanPayment],
    remove: [B2B_TAGS.needsPaymentReview],
  });
  await setOrderMetafields({
    shopDomain: input.order.shopDomain,
    orderId: input.order.shopifyOrderId,
    metafields: {
      bank_payment_status: input.progress.status,
      paid_amount_uah: input.progress.paidAmount.toFixed(2),
      remaining_amount_uah: input.progress.remainingAmount.toFixed(2),
      overpayment_amount_uah: input.progress.overpaymentAmount.toFixed(2),
      bank_transaction_id: input.tx.transaction_id,
      automation_status: "WAITING_BANK_PAYMENT",
    },
  });
}

async function applyFullyPaidBankPaymentState(input: {
  tx: BankTransaction;
  order: B2BOrder;
  progress: ReturnType<typeof calculateBankPaymentProgress> & {
    invoiceDifferenceAmount?: number;
  };
}) {
  const invoiceDifferenceAmount = input.progress.invoiceDifferenceAmount ?? 0;
  const shopifyPayment = await markOrderPaidByBankTransfer({
    shopDomain: input.order.shopDomain,
    orderId: input.order.shopifyOrderId,
    amount: input.progress.paidAmount,
    currency: input.tx.currency,
    bankTransactionId: input.tx.transaction_id,
  });
  const recordedAmount = shopifyPayment.recordedAmount;
  const presentation = calculateShopifyPaymentPresentation({
    paidAmount: input.progress.paidAmount,
    businessOverpaymentAmount: input.progress.overpaymentAmount,
    shopifyRecordedAmount: Number.isFinite(recordedAmount)
      ? recordedAmount
      : input.progress.expectedAmount,
  });
  const reconcileNote = bankPaymentReconcileNote({
    transactionId: input.tx.transaction_id,
    currency: input.tx.currency,
    paidAmount: input.progress.paidAmount,
    shopifyRecordedAmount: presentation.shopifyRecordedAmount,
    differenceAmount: presentation.bankVsShopifyDifferenceAmount,
  });
  if (invoiceDifferenceAmount !== 0) {
    try {
      await appendOrderNote({
        shopDomain: input.order.shopDomain,
        orderId: input.order.shopifyOrderId,
        marker: `[${input.tx.transaction_id}]:invoice-adjustment`,
        message: [
          `Банківська оплата за номером замовлення та ІПН підтверджена.`,
          `Отримано ${input.progress.paidAmount.toFixed(2)} ${input.tx.currency};`,
          `сума рахунку ${input.progress.expectedAmount.toFixed(2)} ${input.tx.currency};`,
          `коригування ${invoiceDifferenceAmount >= 0 ? "+" : ""}${invoiceDifferenceAmount.toFixed(2)} ${input.tx.currency}.`,
          "Замовлення вважається оплаченим повністю.",
        ].join(" "),
      });
    } catch (error) {
      await writeAutomationLog({
        shopifyOrderId: input.order.shopifyOrderId,
        eventType: "bank/reconcile",
        step: "invoice_adjustment_note",
        status: "WARN",
        message: "Payment was accepted, but the invoice adjustment comment failed",
        error,
        metadata: { transactionId: input.tx.transaction_id },
      });
    }
  }

  if (presentation.bankVsShopifyDifferenceAmount !== 0) {
    try {
      await appendOrderNote({
        shopDomain: input.order.shopDomain,
        orderId: input.order.shopifyOrderId,
        marker: `[${input.tx.transaction_id}]`,
        message: reconcileNote,
      });
    } catch (error) {
      await writeAutomationLog({
        shopifyOrderId: input.order.shopifyOrderId,
        eventType: "bank/reconcile",
        step: "payment_reconcile_note",
        status: "WARN",
        message: "Bank payment difference was recorded, but the Shopify order note failed",
        error,
        metadata: { transactionId: input.tx.transaction_id },
      });
    }
  }
  if (presentation.status !== input.progress.status) {
    await prisma.b2BOrder.update({
      where: { shopifyOrderId: input.order.shopifyOrderId },
      data: { paymentStatus: presentation.status },
    });
  }

  await syncOrderLinkPaymentStatus(input.order.shopifyOrderId, "BANK_TRANSFER_PAID");
  await updateOrderTags({
    shopDomain: input.order.shopDomain,
    orderId: input.order.shopifyOrderId,
    add: [
      B2B_TAGS.paymentMatched,
      B2B_TAGS.bankTransferPaid,
      ...(presentation.status === "PAID_WITH_OVERPAYMENT"
        ? [B2B_TAGS.paidWithOverpayment]
        : []),
    ],
    remove: [
      B2B_TAGS.waitingIbanPayment,
      B2B_TAGS.needsPaymentReview,
      B2B_TAGS.partiallyPaid,
    ],
  });
  await setOrderMetafields({
    shopDomain: input.order.shopDomain,
    orderId: input.order.shopifyOrderId,
    metafields: {
      bank_payment_status: presentation.status,
      paid_amount_uah: input.progress.paidAmount.toFixed(2),
      remaining_amount_uah: input.progress.remainingAmount.toFixed(2),
      overpayment_amount_uah: presentation.overpaymentAmount.toFixed(2),
      shopify_recorded_paid_amount_uah: presentation.shopifyRecordedAmount.toFixed(2),
      bank_vs_shopify_difference_uah:
        presentation.bankVsShopifyDifferenceAmount.toFixed(2),
      bank_vs_invoice_difference_uah: invoiceDifferenceAmount.toFixed(2),
      payment_reconcile_note: reconcileNote,
      bank_transaction_id: input.tx.transaction_id,
      shopify_bank_transaction_id: shopifyPayment.transaction.id,
      automation_status: "PAYMENT_CONFIRMED",
    },
  });
  return { ...shopifyPayment, presentation };
}

async function completeBankPaymentSideEffects(input: {
  tx: BankTransaction;
  order: B2BOrder;
  invoiceNumber?: string | null;
  progress: ReturnType<typeof calculateBankPaymentProgress>;
  presentation: ReturnType<typeof calculateShopifyPaymentPresentation>;
}) {
  const shopifyOrder = (await getShopifyOrder({
    shopDomain: input.order.shopDomain,
    orderId: input.order.shopifyOrderId,
  })) as ShopifyOrderPayload;
  const buyer = normalizeB2BAttributes({
    ...getOrderAttributes(shopifyOrder),
    buyer_type: input.order.buyerType ?? "fop_company",
    payment_preference: input.order.paymentPreference ?? "bank_invoice",
    fop_name: input.order.fopName ?? "",
    fop_tax_id: input.order.fopTaxId ?? "",
    fop_legal_address: input.order.fopLegalAddress ?? "",
    docs_email: input.order.docsEmail ?? "",
    docs_phone: input.order.docsPhone ?? "",
    accounting_comment: input.order.accountingComment ?? "",
  });

  try {
    await createPostPaymentDocuments({
      order: shopifyOrder,
      buyer,
      invoiceNumber: input.invoiceNumber ?? "",
      transactionId: input.tx.transaction_id,
      shopDomain: input.order.shopDomain,
      paymentStatus: input.presentation.status,
      paidAmount: input.progress.paidAmount,
      remainingAmount: input.progress.remainingAmount,
      overpaymentAmount: input.presentation.overpaymentAmount,
    });
    await syncOrderLinkPaymentStatus(input.order.shopifyOrderId, "READY_TO_FULFILL_AFTER_BANK_PAYMENT");
  } catch (error) {
    await writeAutomationLog({
      shopifyOrderId: input.order.shopifyOrderId,
      eventType: "bank/reconcile",
      step: "post_payment_documents",
      status: "WARN",
      message: "Bank payment matched in Shopify, but post-payment documents failed",
      error,
      metadata: { transactionId: input.tx.transaction_id },
    });
  }

  try {
    await notifyDiloshopOrderReady({
      order: shopifyOrder,
      shopDomain: input.order.shopDomain,
      transactionId: input.tx.transaction_id,
    });
  } catch (error) {
    await writeAutomationLog({
      shopifyOrderId: input.order.shopifyOrderId,
      eventType: "bank/reconcile",
      step: "diloshop_notify",
      status: "WARN",
      message: "Bank payment matched in Shopify, but Diloshop notify failed",
      error,
      metadata: { transactionId: input.tx.transaction_id },
    });
  }

  return shopifyOrder;
}

async function finalizeMatchedBankPayment(input: {
  tx: BankTransaction;
  order: B2BOrder;
  expectedAmount: number;
  confidence: number;
  matchingMethod: string;
  invoiceNumber?: string | null;
}) {
  const progress = await attachBankPaymentAndCalculateProgress(input);
  if (!progress.isFullyPaid) {
    await applyPartialBankPaymentState({
      tx: input.tx,
      order: input.order,
      progress,
    });
    return {
      transactionId: input.tx.transaction_id,
      status: progress.status,
      shopifyOrderId: input.order.shopifyOrderId,
      shopifyOrderName: input.order.shopifyOrderName,
      expectedAmount: progress.expectedAmount,
      paidAmount: progress.paidAmount,
      remainingAmount: progress.remainingAmount,
    };
  }

  const shopifyPayment = await applyFullyPaidBankPaymentState({
    tx: input.tx,
    order: input.order,
    progress,
  });
  await completeBankPaymentSideEffects({
    tx: input.tx,
    order: input.order,
    invoiceNumber: input.invoiceNumber,
    progress,
    presentation: shopifyPayment.presentation,
  });

  return {
    transactionId: input.tx.transaction_id,
    status: shopifyPayment.presentation.status,
    shopifyOrderId: input.order.shopifyOrderId,
    shopifyOrderName: input.order.shopifyOrderName,
    shopifyPaymentTransactionId: shopifyPayment.transaction.id,
    shopifyPaymentCreated: shopifyPayment.created,
    expectedAmount: progress.expectedAmount,
    paidAmount: progress.paidAmount,
    remainingAmount: progress.remainingAmount,
    overpaymentAmount: shopifyPayment.presentation.overpaymentAmount,
    shopifyRecordedAmount: shopifyPayment.presentation.shopifyRecordedAmount,
    bankVsShopifyDifferenceAmount:
      shopifyPayment.presentation.bankVsShopifyDifferenceAmount,
  };
}

async function finalizeMatchedBankPaymentSafe(input: {
  tx: BankTransaction;
  order: B2BOrder;
  expectedAmount: number;
  confidence: number;
  matchingMethod: string;
  invoiceNumber?: string | null;
}) {
  try {
    const result = await finalizeMatchedBankPayment(input);
    const status = String(result.status);
    await notifyExternalOpsAlert({
      source: "bank",
      eventType: `payment_${status.toLowerCase()}_${input.tx.transaction_id.slice(-8)}`,
      severity: status === "PAID" ? "info" : "warning",
      shopifyOrderId: input.order.shopifyOrderId,
      message: [
        `${input.order.shopifyOrderName ?? input.order.shopifyOrderId}: ${status}`,
        `Получено ${result.paidAmount.toFixed(2)} ${input.tx.currency}`,
        `Ожидалось ${result.expectedAmount.toFixed(2)} ${input.tx.currency}`,
        `Остаток ${result.remainingAmount.toFixed(2)} ${input.tx.currency}`,
      ].join(" · "),
      metadata: { bankTransactionId: input.tx.transaction_id },
    }).catch(() => {});
    return result;
  } catch (error) {
    await writeAutomationLog({
      shopifyOrderId: input.order.shopifyOrderId,
      eventType: "bank/reconcile",
      step: "matched_payment_finalize",
      status: "ERROR",
      message: "Matched bank payment finalization failed",
      error,
      metadata: { transactionId: input.tx.transaction_id },
    });
    return {
      transactionId: input.tx.transaction_id,
      status: "ERROR" as const,
      shopifyOrderId: input.order.shopifyOrderId,
      shopifyOrderName: input.order.shopifyOrderName,
      reason: error instanceof Error ? error.message : "finalize_failed",
    };
  }
}

export async function reconcileBankPayments(input?: { from?: Date; to?: Date }) {
  const to = input?.to ?? new Date();
  const from = input?.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const provider = await getBankStatementProvider();
  const transactions = await provider.fetchTransactions(from, to);
  return reconcileBankTransactions(transactions, { from, to });
}

export async function reconcileBankTransactions(
  transactions: BankTransaction[],
  range?: { from?: Date; to?: Date }
) {
  const to = range?.to ?? new Date();
  const from = range?.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { candidates, openOrders, invoiceByOrder, stats } = await buildBankReconciliationCandidates();

  const results = [];
  for (const tx of transactions) {
    const saved = await saveBankTransaction(tx);
    if (
      saved.matchingMethod === "liqpay_soid_order_exists" ||
      saved.matchingMethod === "manual_multi_order_allocation"
    ) {
      results.push({
        transactionId: tx.transaction_id,
        status: "SKIPPED",
        reason: saved.matchingMethod === "manual_multi_order_allocation"
          ? "manual_multi_order_allocation_already_applied"
          : "ignored_online_payment",
      });
      continue;
    }
    if (saved.status === "MATCHED") {
      const order =
        openOrders.find((candidate) => candidate.shopifyOrderId === saved.matchedShopifyOrderId) ??
        (await prisma.b2BOrder.findUnique({
          where: { shopifyOrderId: saved.matchedShopifyOrderId ?? "" },
        })) ??
        (await ensureB2BOrderRecord({
          shopifyOrderId: saved.matchedShopifyOrderId ?? "",
          shopDomain: openOrders[0]?.shopDomain,
        }));
      if (order && ["READY_TO_FULFILL_AFTER_BANK_PAYMENT", "DOCS_SENT"].includes(order.status)) {
        results.push({
          transactionId: tx.transaction_id,
          status: "SKIPPED",
          reason: "already_finalized",
          shopifyOrderId: order.shopifyOrderId,
        });
        continue;
      }
      if (order) {
        const candidate = candidates.find(
          (row) => row.shopifyOrderId === order.shopifyOrderId
        );
        const expectedAmount =
          candidate?.amount ?? Number(order.expectedAmount ?? order.orderTotalAmount ?? 0);
        if (expectedAmount <= 0) {
          results.push({
            transactionId: tx.transaction_id,
            status: "ERROR",
            reason: "expected_amount_missing",
            shopifyOrderId: order.shopifyOrderId,
          });
          continue;
        }
        results.push(
          await finalizeMatchedBankPaymentSafe({
            tx,
            order,
            expectedAmount,
            confidence: Number(saved.matchConfidence ?? 1),
            matchingMethod: saved.matchingMethod ?? "existing_confirmed_match",
            invoiceNumber: invoiceByOrder.get(order.shopifyOrderId)?.number,
          })
        );
        continue;
      }
      results.push({ transactionId: tx.transaction_id, skipped: true });
      continue;
    }

    const onlineAcquiring = await reconcileLiqPayAcquiringTransaction(tx);
    if (onlineAcquiring) {
      results.push(onlineAcquiring);
      continue;
    }

    try {
      const match = matchBankTransaction(tx, candidates);
      if (match.status === "NEEDS_REVIEW" && !match.candidate) {
        const multiOrder = "candidates" in match && Array.isArray(match.candidates)
          ? {
              candidates: match.candidates,
              expectedAmount: "expectedAmount" in match ? match.expectedAmount : null,
              amountDifference: "amountDifference" in match ? match.amountDifference : null,
            }
          : null;
        await clearStaleAmbiguousOrderReview({
          transactionId: tx.transaction_id,
          staleOrderId: saved.matchedShopifyOrderId,
          staleMatchingMethod: saved.matchingMethod,
        });
        await prisma.bankPayment.update({
          where: { transactionId: tx.transaction_id },
          data: {
            status: "NEEDS_REVIEW",
            // An ambiguous hint is a review for the payment itself, not for
            // an arbitrary order that happened to be returned first.
            matchedShopifyOrderId: null,
            matchingMethod: match.reason,
            matchConfidence: match.confidence,
            rawPayload: paymentPayloadWithMatching({
              rawPayload: tx.raw_payload,
              matchingMethod: match.reason,
              matchingConfidence: match.confidence,
              ...(multiOrder
                ? {
                    matchingDetails: {
                      candidates: multiOrder.candidates.map((candidate) => ({
                        shopifyOrderId: candidate.shopifyOrderId,
                        shopifyOrderName: candidate.shopifyOrderName ?? null,
                        invoiceNumber: candidate.invoiceNumber ?? null,
                        amount: candidate.amount,
                        currency: candidate.currency,
                        fopTaxId: candidate.fopTaxId ?? null,
                      })),
                      expectedAmount: multiOrder.expectedAmount,
                      amountDifference: multiOrder.amountDifference,
                    },
                  }
                : {}),
            }),
          },
        });
        results.push({ transactionId: tx.transaction_id, status: "NEEDS_REVIEW", reason: match.reason });
        const multiOrderMessage = multiOrder
          ? [
              `Платёж за несколько B2B-счетов: ${tx.amount.toFixed(2)} ${tx.currency}`,
              `Основание: в назначении указаны номера заказов; у всех совпадает Tax ID плательщика`,
              ...multiOrder.candidates.map(
                (candidate) =>
                  `${candidate.shopifyOrderName ?? candidate.shopifyOrderId}: ${candidate.amount.toFixed(2)} ${candidate.currency}${candidate.invoiceNumber ? ` · ${candidate.invoiceNumber}` : ""}`
              ),
              `Сумма счетов: ${Number(multiOrder.expectedAmount ?? 0).toFixed(2)} ${tx.currency}`,
              multiOrder.amountDifference
                ? `Расхождение: ${Number(multiOrder.amountDifference).toFixed(2)} ${tx.currency}`
                : "Сумма совпадает: можно распределить после ручного подтверждения.",
              `Transaction: …${tx.transaction_id.slice(-12)}`,
            ].join("\n")
          : `Платёж требует проверки: ${tx.amount.toFixed(2)} ${tx.currency} · ${match.reason} · Shopify-заказ не выбран · transaction …${tx.transaction_id.slice(-12)}`;
        await notifyExternalOpsAlert({
          source: "bank",
          // Keep this separate from the generic review alert so a transaction
          // that was already reported can still publish its richer split-order
          // proposal after the matcher learns all referenced invoices.
          eventType: multiOrder
            ? `multi_order_review_${tx.transaction_id.slice(-8)}`
            : `needs_review_${tx.transaction_id.slice(-8)}`,
          severity: "warning",
          message: multiOrderMessage,
          metadata: { bankTransactionId: tx.transaction_id },
          ...(multiOrder
            ? {
                replyMarkup: {
                  inline_keyboard: [
                    ...multiOrder.candidates.map((candidate) => [
                      {
                        text: `Открыть ${candidate.shopifyOrderName ?? candidate.shopifyOrderId}`,
                        callback_data: `order|${candidate.shopifyOrderId}`,
                      },
                    ]),
                    [{ text: "✅ Розподілити на ці рахунки", callback_data: `confirm|apply-bank-proposal|${saved.id}` }],
                  ],
                },
              }
            : {}),
          dedupeWindowHours: null,
        }).catch(() => {});
        continue;
      }
      if (!match.candidate) {
        results.push({ transactionId: tx.transaction_id, status: "NEW" });
        await notifyExternalOpsAlert({
          source: "bank",
          eventType: `unmatched_${tx.transaction_id.slice(-8)}`,
          severity: "warning",
          message: [
            `Платёж без заказа: ${tx.amount.toFixed(2)} ${tx.currency}`,
            tx.payer_name ? `Плательщик: ${tx.payer_name}` : null,
            tx.payer_tax_id ? `Tax ID: ${tx.payer_tax_id}` : null,
            tx.payment_description ? `Назначение: ${tx.payment_description.slice(0, 300)}` : null,
            `Transaction: …${tx.transaction_id.slice(-12)}`,
          ].filter(Boolean).join(" · "),
          metadata: { bankTransactionId: tx.transaction_id },
          dedupeWindowHours: null,
        }).catch(() => {});
        continue;
      }

      if (match.status === "MATCHED") {
        const candidate = match.candidate;
        if (!candidate) continue;
        const order =
          openOrders.find((row) => row.shopifyOrderId === candidate.shopifyOrderId) ??
          (await ensureB2BOrderRecord({
            shopifyOrderId: candidate.shopifyOrderId,
            shopDomain: openOrders[0]?.shopDomain,
          }));
        if (!order) {
          results.push({ transactionId: tx.transaction_id, status: "ERROR", reason: "b2b_order_missing" });
          continue;
        }
        if (candidate.amount <= 0) {
          results.push({
            transactionId: tx.transaction_id,
            status: "ERROR",
            reason: "expected_amount_missing",
            shopifyOrderId: order.shopifyOrderId,
          });
          continue;
        }
        results.push(
          await finalizeMatchedBankPaymentSafe({
            tx,
            order,
            expectedAmount: candidate.amount,
            confidence: match.confidence,
            matchingMethod: match.reason,
            invoiceNumber: match.invoiceNumber ?? invoiceByOrder.get(order.shopifyOrderId)?.number,
          })
        );
      } else if (match.status === "NEEDS_REVIEW") {
        const order =
          openOrders.find((row) => row.shopifyOrderId === match.candidate.shopifyOrderId) ??
          (await ensureB2BOrderRecord({
            shopifyOrderId: match.candidate.shopifyOrderId,
            shopDomain: openOrders[0]?.shopDomain,
          }));
        await prisma.bankPayment.update({
          where: { transactionId: tx.transaction_id },
          data: {
            status: "NEEDS_REVIEW",
            matchedShopifyOrderId: match.candidate.shopifyOrderId,
            matchingMethod: match.reason,
            matchConfidence: match.confidence,
            rawPayload: paymentPayloadWithMatching({
              rawPayload: tx.raw_payload,
              matchingMethod: match.reason,
              matchingConfidence: match.confidence,
            }),
          },
        });
        if (order && order.status !== "PARTIALLY_PAID") {
          await prisma.b2BOrder.update({
            where: { shopifyOrderId: match.candidate.shopifyOrderId },
            data: { status: "NEEDS_REVIEW" },
          });
        }
        await updateOrderTags({
          shopDomain: order?.shopDomain,
          orderId: match.candidate.shopifyOrderId,
          add: [B2B_TAGS.needsPaymentReview],
        });
        results.push({ transactionId: tx.transaction_id, status: "NEEDS_REVIEW", reason: match.reason });
        await notifyExternalOpsAlert({
          source: "bank",
          eventType: `needs_review_${tx.transaction_id.slice(-8)}`,
          severity: "warning",
          shopifyOrderId: match.candidate.shopifyOrderId,
          message: `Платёж требует проверки: ${tx.amount.toFixed(2)} ${tx.currency} · ${match.reason} · transaction …${tx.transaction_id.slice(-12)}`,
          metadata: { bankTransactionId: tx.transaction_id },
          dedupeWindowHours: null,
        }).catch(() => {});
      }
    } catch (error) {
      await writeAutomationLog({
        eventType: "bank/reconcile",
        step: "transaction_match",
        status: "ERROR",
        message: "Bank transaction reconciliation failed",
        error,
        metadata: { transactionId: tx.transaction_id },
      });
      results.push({ transactionId: tx.transaction_id, status: "ERROR" });
    }
  }

  return { from, to, checked: transactions.length, candidateStats: stats, results };
}
