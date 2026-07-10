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
  getShopifyOrder,
  markOrderPaidByBankTransfer,
  setOrderMetafields,
  updateOrderTags,
} from "@/lib/shopify/b2b-admin";
import type { BankTransaction } from "@/lib/bank/types";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";
import type { B2BOrder, Prisma } from "@prisma/client";

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

async function applyCriticalBankPaymentMatch(input: {
  tx: BankTransaction;
  order: B2BOrder;
  confidence: number;
  invoiceNumber?: string | null;
}) {
  const { tx, order } = input;

  const shopifyPayment = await markOrderPaidByBankTransfer({
    shopDomain: order.shopDomain,
    orderId: order.shopifyOrderId,
    amount: tx.amount,
    currency: tx.currency,
    bankTransactionId: tx.transaction_id,
  });

  await prisma.bankPayment.update({
    where: { transactionId: tx.transaction_id },
    data: {
      status: "MATCHED",
      matchedShopifyOrderId: order.shopifyOrderId,
      matchConfidence: input.confidence,
    },
  });

  await prisma.b2BOrder.update({
    where: { shopifyOrderId: order.shopifyOrderId },
    data: { status: "PAYMENT_MATCHED" },
  });
  await syncOrderLinkPaymentStatus(order.shopifyOrderId, "BANK_TRANSFER_PAID");

  await updateOrderTags({
    shopDomain: order.shopDomain,
    orderId: order.shopifyOrderId,
    add: [B2B_TAGS.paymentMatched, B2B_TAGS.bankTransferPaid],
    remove: [B2B_TAGS.waitingIbanPayment],
  });

  await setOrderMetafields({
    shopDomain: order.shopDomain,
    orderId: order.shopifyOrderId,
    metafields: {
      bank_payment_status: "BANK_TRANSFER_PAID",
      bank_transaction_id: tx.transaction_id,
      shopify_bank_transaction_id: shopifyPayment.transaction.id,
      automation_status: "PAYMENT_CONFIRMED",
    },
  });
  await updateOrderTags({
    shopDomain: order.shopDomain,
    orderId: order.shopifyOrderId,
    add: [B2B_TAGS.paymentConfirmed],
  });

  return shopifyPayment;
}

async function completeBankPaymentSideEffects(input: {
  tx: BankTransaction;
  order: B2BOrder;
  invoiceNumber?: string | null;
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
  confidence: number;
  invoiceNumber?: string | null;
}) {
  const shopifyPayment = await applyCriticalBankPaymentMatch(input);
  await completeBankPaymentSideEffects({
    tx: input.tx,
    order: input.order,
    invoiceNumber: input.invoiceNumber,
  });

  return {
    transactionId: input.tx.transaction_id,
    status: "MATCHED",
    shopifyOrderId: input.order.shopifyOrderId,
    shopifyPaymentTransactionId: shopifyPayment.transaction.id,
    shopifyPaymentCreated: shopifyPayment.created,
  };
}

async function finalizeMatchedBankPaymentSafe(input: {
  tx: BankTransaction;
  order: B2BOrder;
  confidence: number;
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
      if (order && ["PAYMENT_MATCHED", "READY_TO_FULFILL_AFTER_BANK_PAYMENT", "DOCS_SENT"].includes(order.status)) {
        results.push({
          transactionId: tx.transaction_id,
          status: "SKIPPED",
          reason: "already_finalized",
          shopifyOrderId: order.shopifyOrderId,
        });
        continue;
      }
      if (order) {
        results.push(
          await finalizeMatchedBankPaymentSafe({
            tx,
            order,
            confidence: Number(saved.matchConfidence ?? 1),
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
        results.push(
          await finalizeMatchedBankPaymentSafe({
            tx,
            order,
            confidence: match.confidence,
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
            matchConfidence: match.confidence,
          },
        });
        if (order) {
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
