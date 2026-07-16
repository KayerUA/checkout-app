import { prisma } from "@/lib/db";
import { getBankStatementProvider } from "@/lib/bank";
import { buildBankReconciliationCandidates, ensureB2BOrderRecord } from "@/lib/reconciliation/candidates";
import { matchBankTransaction } from "@/lib/reconciliation/matcher";
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
  const overpaymentCents = Math.max(businessOverpaymentCents, differenceCents, 0);
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
    },
  } as Prisma.InputJsonValue;
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
    const progress = calculateBankPaymentProgress(
      input.expectedAmount,
      Number(aggregate._sum.amount ?? 0)
    );

    await db.b2BOrder.update({
      where: { shopifyOrderId: input.order.shopifyOrderId },
      data: {
        orderTotalAmount: progress.expectedAmount,
        expectedAmount: progress.expectedAmount,
        paidAmount: progress.paidAmount,
        remainingAmount: progress.remainingAmount,
        paymentStatus: progress.status,
        status: progress.isFullyPaid ? "PAYMENT_MATCHED" : "PARTIALLY_PAID",
      },
    });
    return progress;
  }, { isolationLevel: "Serializable" });
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
  progress: ReturnType<typeof calculateBankPaymentProgress>;
}) {
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
    return await finalizeMatchedBankPayment(input);
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

    try {
      const match = matchBankTransaction(tx, candidates);
      if (!match.candidate) {
        results.push({ transactionId: tx.transaction_id, status: "NEW" });
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
