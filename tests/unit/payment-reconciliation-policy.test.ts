import { describe, expect, it } from "vitest";
import { shouldRemoveUnpaidAttempt } from "@/lib/payments/reconciliation-policy";

describe("payment reconciliation cleanup policy", () => {
  it("removes only unpaid attempts belonging to inactive checkouts", () => {
    expect(
      shouldRemoveUnpaidAttempt({ provider: "LIQPAY", checkoutStatus: "COMPLETED", providerStatus: "PENDING" })
    ).toBe(true);
    expect(
      shouldRemoveUnpaidAttempt({ provider: "LIQPAY", checkoutStatus: "ABANDONED", providerStatus: null })
    ).toBe(true);
    expect(
      shouldRemoveUnpaidAttempt({ provider: "LIQPAY", checkoutStatus: "PAYMENT_PENDING", providerStatus: null })
    ).toBe(false);
    expect(
      shouldRemoveUnpaidAttempt({ provider: "LIQPAY", checkoutStatus: "COMPLETED", providerStatus: "PAID" })
    ).toBe(false);
    expect(
      shouldRemoveUnpaidAttempt({ provider: "MONOBANK", checkoutStatus: "COMPLETED", providerStatus: null })
    ).toBe(false);
  });
});
