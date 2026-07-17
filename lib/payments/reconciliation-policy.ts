const INACTIVE_CHECKOUT_STATUSES = new Set(["PAID", "COMPLETED", "ABANDONED"]);

export function shouldRemoveUnpaidAttempt(input: {
  provider: string;
  checkoutStatus: string;
  providerStatus: string | null;
}) {
  return (
    input.provider.toUpperCase() === "LIQPAY" &&
    INACTIVE_CHECKOUT_STATUSES.has(input.checkoutStatus.toUpperCase()) &&
    (input.providerStatus === null || input.providerStatus.toUpperCase() === "PENDING")
  );
}
