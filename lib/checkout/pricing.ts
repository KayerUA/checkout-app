import type { CheckoutLine } from "@prisma/client";

export function calcLineTotal(line: Pick<CheckoutLine, "unitPrice" | "quantity" | "lineDiscountAmount">) {
  return line.unitPrice * line.quantity - line.lineDiscountAmount;
}

export function calcTotals(lines: CheckoutLine[], shippingAmount = 0, discountAmount = 0) {
  const subtotal = lines.reduce((sum, line) => sum + calcLineTotal(line), 0);
  const totalAmount = Math.max(0, subtotal + shippingAmount - discountAmount);
  return { subtotal, shippingAmount, discountAmount, totalAmount };
}

/** Deterministic UAH formatting — avoids SSR/client Intl currency symbol mismatch (₴ vs грн). */
export function formatMoney(kopiyky: number, currency = "UAH") {
  const negative = kopiyky < 0;
  const abs = Math.abs(kopiyky);
  const whole = Math.floor(abs / 100);
  const cents = (abs % 100).toString().padStart(2, "0");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const amount = `${negative ? "-" : ""}${wholeStr},${cents}`;

  if (currency === "UAH") return `${amount} грн`;
  return `${amount} ${currency}`;
}
