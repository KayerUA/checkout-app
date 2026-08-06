import type { CheckoutStatus } from "@prisma/client";

const transitions: Record<CheckoutStatus, CheckoutStatus[]> = {
  DRAFT: ["READY", "ABANDONED"],
  READY: ["PAYMENT_PENDING", "ABANDONED", "DRAFT"],
  PAYMENT_PENDING: ["PAID", "ABANDONED", "READY"],
  PAID: ["COMPLETED"],
  COMPLETED: [],
  // A cart identifier is stable across visits. If the buyer comes back after
  // the inactivity job marked its unfinished checkout abandoned, the public
  // form submits the now-complete data directly as READY.
  ABANDONED: ["DRAFT", "READY"],
};

export function canTransition(from: CheckoutStatus, to: CheckoutStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function assertTransition(from: CheckoutStatus, to: CheckoutStatus) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid checkout transition: ${from} -> ${to}`);
  }
}
