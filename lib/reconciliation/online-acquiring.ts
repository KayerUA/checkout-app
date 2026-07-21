import type { BankTransaction } from "@/lib/bank/types";

const LIQPAY_SOID_PATTERN = /\bSOID\s+([^\s]+)/i;

/**
 * LiqPay's bank settlement reference is `${CheckoutSession.sourceIdentifier}_${timestamp}`.
 * It is an online-card settlement, not a B2B invoice transfer.
 */
export function liqPayAcquiringSourceIdentifier(
  transaction: Pick<BankTransaction, "payer_tax_id" | "payment_description">
): string | null {
  const description = transaction.payment_description ?? "";
  if (!/\bLIQPAY\b/i.test(description)) return null;

  const rawReference = description.match(LIQPAY_SOID_PATTERN)?.[1];
  if (!rawReference) return null;

  const match = rawReference.match(/^(chk_[A-Za-z0-9_-]+)_\d{13}$/);
  return match?.[1] ?? null;
}
