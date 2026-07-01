type LogContext = Record<string, string | number | boolean | null | undefined>;

export function log(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  context?: LogContext
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logWithCorrelation(
  level: "info" | "warn" | "error",
  message: string,
  correlation: {
    merchantId?: string;
    checkoutSessionId?: string;
    paymentAttemptId?: string;
    providerReference?: string;
    shopifyOrderGid?: string;
    webhookDeliveryId?: string;
    fiscalReceiptId?: string;
  },
  extra?: LogContext
) {
  log(level, message, { ...correlation, ...extra });
}
