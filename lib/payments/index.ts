import type { PaymentProvider } from "@prisma/client";
import { liqpayAdapter } from "@/lib/payments/liqpay";
import { monobankAdapter } from "@/lib/payments/monobank";
import type { PaymentAdapter } from "@/lib/payments/types";

const adapters: Record<PaymentProvider, PaymentAdapter | null> = {
  MONOBANK: monobankAdapter,
  LIQPAY: liqpayAdapter,
  WAYFORPAY: null,
  COD: null,
  BANK_INVOICE: null,
};

export function getPaymentAdapter(provider: PaymentProvider): PaymentAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`Payment adapter not implemented: ${provider}`);
  return adapter;
}
