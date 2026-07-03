import { prisma } from "@/lib/db";
import { getBankStatementProvider } from "@/lib/bank";
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
import type { Prisma } from "@prisma/client";

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
  const openOrders = await prisma.b2BOrder.findMany({
    where: { status: { in: ["INVOICE_SENT", "WAITING_BANK_PAYMENT", "CREATED", "NEEDS_REVIEW"] } },
  });
  const invoices = await prisma.b2BDocument.findMany({
    where: {
      type: "invoice",
      shopifyOrderId: { in: openOrders.map((order) => order.shopifyOrderId) },
    },
  });
  const invoiceByOrder = new Map(invoices.map((invoice) => [invoice.shopifyOrderId, invoice]));
  const candidates = openOrders.map((order) => ({
    shopifyOrderId: order.shopifyOrderId,
    shopifyOrderName: order.shopifyOrderName,
    invoiceNumber: invoiceByOrder.get(order.shopifyOrderId)?.number,
    fopName: order.fopName,
    amount: Number(order.orderTotalAmount ?? 0),
    currency: order.orderCurrency ?? "UAH",
  }));

  const results = [];
  for (const tx of transactions) {
    const saved = await saveBankTransaction(tx);
    if (saved.status === "MATCHED") {
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
        const order = openOrders.find((candidate) => candidate.shopifyOrderId === match.candidate?.shopifyOrderId);
        if (!order) continue;
        await prisma.bankPayment.update({
          where: { transactionId: tx.transaction_id },
          data: {
            status: "MATCHED",
            matchedShopifyOrderId: order.shopifyOrderId,
            matchConfidence: match.confidence,
          },
        });
        await prisma.b2BOrder.update({
          where: { shopifyOrderId: order.shopifyOrderId },
          data: { status: "PAYMENT_MATCHED" },
        });
        await updateOrderTags({
          shopDomain: order.shopDomain,
          orderId: order.shopifyOrderId,
          add: [B2B_TAGS.paymentMatched, B2B_TAGS.bankTransferPaid],
          remove: [B2B_TAGS.waitingIbanPayment],
        });

        const shopifyPayment = await markOrderPaidByBankTransfer({
          shopDomain: order.shopDomain,
          orderId: order.shopifyOrderId,
          amount: tx.amount,
          currency: tx.currency,
          bankTransactionId: tx.transaction_id,
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

        const shopifyOrder = (await getShopifyOrder({
          shopDomain: order.shopDomain,
          orderId: order.shopifyOrderId,
        })) as ShopifyOrderPayload;
        const buyer = normalizeB2BAttributes({
          ...getOrderAttributes(shopifyOrder),
          buyer_type: order.buyerType ?? "fop_company",
          payment_preference: order.paymentPreference ?? "bank_invoice",
          fop_name: order.fopName ?? "",
          fop_tax_id: order.fopTaxId ?? "",
          fop_legal_address: order.fopLegalAddress ?? "",
          docs_email: order.docsEmail ?? "",
          docs_phone: order.docsPhone ?? "",
          accounting_comment: order.accountingComment ?? "",
        });
        await createPostPaymentDocuments({
          order: shopifyOrder,
          buyer,
          invoiceNumber: match.invoiceNumber ?? invoiceByOrder.get(order.shopifyOrderId)?.number ?? "",
          transactionId: tx.transaction_id,
          shopDomain: order.shopDomain,
        });
        await notifyDiloshopOrderReady({
          order: shopifyOrder,
          shopDomain: order.shopDomain,
          transactionId: tx.transaction_id,
        });
        results.push({
          transactionId: tx.transaction_id,
          status: "MATCHED",
          shopifyPaymentTransactionId: shopifyPayment.transaction.id,
          shopifyPaymentCreated: shopifyPayment.created,
        });
      } else if (match.status === "NEEDS_REVIEW") {
        await prisma.bankPayment.update({
          where: { transactionId: tx.transaction_id },
          data: {
            status: "NEEDS_REVIEW",
            matchedShopifyOrderId: match.candidate.shopifyOrderId,
            matchConfidence: match.confidence,
          },
        });
        await prisma.b2BOrder.update({
          where: { shopifyOrderId: match.candidate.shopifyOrderId },
          data: { status: "NEEDS_REVIEW" },
        });
        const order = openOrders.find((candidate) => candidate.shopifyOrderId === match.candidate?.shopifyOrderId);
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

  return { from, to, checked: transactions.length, results };
}
