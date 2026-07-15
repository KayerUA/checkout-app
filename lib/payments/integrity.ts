export class PaymentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentIntegrityError";
  }
}
export function assertPaymentIntegrity(input: {
  expectedAmount: number;
  actualAmount: number;
  expectedCurrency: string;
  actualCurrency?: string | null;
}) {
  if (!Number.isInteger(input.actualAmount) || input.actualAmount !== input.expectedAmount) {
    throw new PaymentIntegrityError("Payment amount mismatch");
  }

  if (
    input.actualCurrency &&
    input.actualCurrency.toUpperCase() !== input.expectedCurrency.toUpperCase()
  ) {
    throw new PaymentIntegrityError("Payment currency mismatch");
  }
}
