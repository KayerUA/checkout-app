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

export type ParsedOrderRef = {
  full: string;
  numeric: number;
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

/** Shopify #UA1155 → { full: UA1155, numeric: 1155 } */
export function parseShopifyOrderName(orderName?: string | null): ParsedOrderRef | null {
  const raw = (orderName ?? "").trim().replace(/^#/, "");
  const match = raw.match(/^UA[-\s]?(\d+)$/i) ?? raw.match(/^(\d{3,6})$/);
  if (!match) return null;
  const numeric = Number.parseInt(match[1], 10);
  if (!Number.isFinite(numeric) || numeric < 100) return null;
  return { full: `UA${numeric}`, numeric };
}

/**
 * Витягує номери замовлень з призначення платежу.
 * Клієнти часто пишуть «рахунок 1155» / «замовлення 1155» замість «UA1155».
 */
export function extractOrderNumberHints(description?: string | null): ParsedOrderRef[] {
  if (!description?.trim()) return [];
  const normalized = description.replace(/\s+/g, " ").trim();
  const refs = new Map<string, ParsedOrderRef>();

  const add = (numeric: number) => {
    if (!Number.isFinite(numeric) || numeric < 100) return;
    const full = `UA${numeric}`;
    refs.set(full, { full, numeric });
  };

  for (const match of normalized.matchAll(/\b(?:№|#|N[o.]?)?\s*UA[-\s]?(\d{3,6})\b/gi)) {
    add(Number.parseInt(match[1], 10));
  }

  for (const match of normalized.matchAll(/(?:№|#)\s*(\d{3,6})\b/g)) {
    add(Number.parseInt(match[1], 10));
  }

  const keywordPattern =
    /(?:замовлен\w*|рахунк\w*|рах\.|сч[её]т\w*|сч\.|schet|оплат\w*|order|inv\w*|payment|за\s+(?:рахунк\w*|замовлен\w*|сч[её]т\w*))[^0-9]{0,28}(?:№|#|N[o.]?)?\s*(?:UA[-\s]?)?(\d{3,6})\b/gi;
  for (const match of normalized.matchAll(keywordPattern)) {
    add(Number.parseInt(match[1], 10));
  }

  return [...refs.values()];
}

function descriptionHasOrderNumber(description: string | null | undefined, orderName?: string | null) {
  if (!description || !orderName) return false;
  const normalizedDescription = description.replace(/\s+/g, " ");
  const order = orderName.replace(/^#/, "");
  return (
    normalizedDescription.includes(orderName) ||
    normalizedDescription.includes(`№ ${order}`) ||
    normalizedDescription.includes(`#${order}`) ||
    normalizedDescription.toUpperCase().includes(order.toUpperCase())
  );
}

function findCandidatesByOrderHints(description: string | null | undefined, candidates: MatchCandidate[]) {
  const hints = extractOrderNumberHints(description);
  if (!hints.length) return [];

  const matched: MatchCandidate[] = [];
  for (const hint of hints) {
    for (const candidate of candidates) {
      const parsed = parseShopifyOrderName(candidate.shopifyOrderName);
      if (!parsed) continue;
      if (parsed.full === hint.full || parsed.numeric === hint.numeric) {
        if (!matched.some((row) => row.shopifyOrderId === candidate.shopifyOrderId)) {
          matched.push(candidate);
        }
      }
    }
  }
  return matched;
}

function amountsEqual(left: number, right: number) {
  return Math.abs(Number(left.toFixed(2)) - Number(right.toFixed(2))) < 0.01;
}

function pickUniqueByAmount(candidates: MatchCandidate[], amount: number, currency: string) {
  const exact = candidates.filter(
    (candidate) => amountsEqual(candidate.amount, amount) && candidate.currency === currency
  );
  return exact.length === 1 ? exact[0] : null;
}

function matchResultForCandidate(
  candidate: MatchCandidate,
  amount: number,
  currency: string,
  input: { confidence: number; reason: string; invoiceNumber?: string | null }
) {
  if (amountsEqual(candidate.amount, amount) && candidate.currency === currency) {
    return {
      status: "MATCHED" as const,
      confidence: input.confidence,
      candidate,
      reason: input.reason,
      invoiceNumber: input.invoiceNumber,
    };
  }
  return {
    status: "NEEDS_REVIEW" as const,
    confidence: Math.max(0.85, input.confidence - 0.08),
    candidate,
    reason: `${input.reason}_amount_mismatch`,
    invoiceNumber: input.invoiceNumber,
  };
}

export function matchBankTransaction(tx: BankTransaction, candidates: MatchCandidate[]) {
  const invoiceNumber = extractInvoiceNumber(tx.payment_description);
  const amount = Number(tx.amount.toFixed(2));

  if (invoiceNumber) {
    const byInvoice = candidates.find((candidate) => candidate.invoiceNumber === invoiceNumber);
    if (!byInvoice) return { status: "NEW" as const, invoiceNumber };
    return matchResultForCandidate(byInvoice, amount, tx.currency, {
      confidence: 1,
      reason: "invoice_number_exact_amount",
      invoiceNumber,
    });
  }

  const hintedMatches = findCandidatesByOrderHints(tx.payment_description, candidates);
  if (hintedMatches.length === 1) {
    return matchResultForCandidate(hintedMatches[0], amount, tx.currency, {
      confidence: 0.97,
      reason: "order_number_hint",
    });
  }
  if (hintedMatches.length > 1) {
    const byAmount = pickUniqueByAmount(hintedMatches, amount, tx.currency);
    if (byAmount) {
      return matchResultForCandidate(byAmount, amount, tx.currency, {
        confidence: 0.93,
        reason: "order_number_hint_disambiguated_by_amount",
      });
    }
    return {
      status: "NEEDS_REVIEW" as const,
      confidence: 0.8,
      candidate: hintedMatches[0],
      reason: "ambiguous_order_number_hint",
    };
  }

  const byOrderNumber = candidates.find((candidate) =>
    descriptionHasOrderNumber(tx.payment_description, candidate.shopifyOrderName)
  );
  if (byOrderNumber) {
    return matchResultForCandidate(byOrderNumber, amount, tx.currency, {
      confidence: 0.98,
      reason: "order_number_exact_amount",
    });
  }

  const soft = candidates.find(
    (candidate) =>
      amountsEqual(candidate.amount, amount) &&
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

  if (candidates.length === 1) {
    const only = candidates[0];
    const parsed = parseShopifyOrderName(only.shopifyOrderName);
    const description = tx.payment_description ?? "";
    const numericInDescription =
      parsed &&
      (description.includes(String(parsed.numeric)) ||
        description.toUpperCase().includes(parsed.full.toUpperCase()));
    if (
      parsed &&
      numericInDescription &&
      amountsEqual(only.amount, amount) &&
      only.currency === tx.currency
    ) {
      return {
        status: "MATCHED" as const,
        confidence: 0.92,
        candidate: only,
        reason: "single_open_candidate_amount_and_order_number",
      };
    }
  }

  return { status: "NEW" as const };
}
