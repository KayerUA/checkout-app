import { INVOICE_NUMBER_PATTERN } from "@/lib/b2b/constants";
import type { BankTransaction } from "@/lib/bank/types";

export type MatchCandidate = {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  invoiceNumber?: string | null;
  fopName?: string | null;
  amount: number;
  currency: string;
};

function normalizeName(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/фоп|тов|пп|приватне підприємство/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function includesName(a?: string | null, b?: string | null) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

export function extractInvoiceNumber(description?: string | null) {
  return description?.match(INVOICE_NUMBER_PATTERN)?.[0]?.toUpperCase() ?? null;
}

function descriptionHasOrderNumber(description: string | null | undefined, orderName?: string | null) {
  if (!description || !orderName) return false;
  const normalizedDescription = description.replace(/\s+/g, " ");
  const order = orderName.replace(/^#/, "");
  return normalizedDescription.includes(orderName) || normalizedDescription.includes(`№ ${order}`) || normalizedDescription.includes(`#${order}`) || normalizedDescription.includes(order);
}

export function matchBankTransaction(tx: BankTransaction, candidates: MatchCandidate[]) {
  const invoiceNumber = extractInvoiceNumber(tx.payment_description);
  const amount = Number(tx.amount.toFixed(2));

  if (invoiceNumber) {
    const byInvoice = candidates.find((candidate) => candidate.invoiceNumber === invoiceNumber);
    if (!byInvoice) return { status: "NEW" as const, invoiceNumber };
    if (Number(byInvoice.amount.toFixed(2)) === amount && byInvoice.currency === tx.currency) {
      return {
        status: "MATCHED" as const,
        confidence: 1,
        candidate: byInvoice,
        invoiceNumber,
      };
    }
    return {
      status: "NEEDS_REVIEW" as const,
      confidence: 0.95,
      candidate: byInvoice,
      invoiceNumber,
      reason: "amount_mismatch",
    };
  }

  const byOrderNumber = candidates.find((candidate) =>
    descriptionHasOrderNumber(tx.payment_description, candidate.shopifyOrderName)
  );
  if (byOrderNumber) {
    if (Number(byOrderNumber.amount.toFixed(2)) === amount && byOrderNumber.currency === tx.currency) {
      return {
        status: "MATCHED" as const,
        confidence: 0.98,
        candidate: byOrderNumber,
        reason: "order_number_exact_amount",
      };
    }
    return {
      status: "NEEDS_REVIEW" as const,
      confidence: 0.9,
      candidate: byOrderNumber,
      reason: "order_number_amount_mismatch",
    };
  }

  const soft = candidates.find(
    (candidate) =>
      Number(candidate.amount.toFixed(2)) === amount &&
      candidate.currency === tx.currency &&
      includesName(tx.payer_name, candidate.fopName)
  );
  if (soft) {
    return {
      status: "NEEDS_REVIEW" as const,
      confidence: 0.75,
      candidate: soft,
      reason: "amount_and_name_soft_match",
    };
  }

  return { status: "NEW" as const };
}
