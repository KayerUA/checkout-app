import crypto from "node:crypto";
import type { PaymentProvider } from "@prisma/client";

export type PaymentInitResult = {
  redirectUrl?: string;
  widgetData?: Record<string, string>;
  providerReference: string;
  requestPayload: Record<string, unknown>;
};

export type PaymentCallbackResult = {
  providerReference: string;
  status: "PAID" | "FAILED" | "PENDING";
  amount: number;
  modifiedAt?: Date;
  rawPayload: Record<string, unknown>;
};

export interface PaymentAdapter {
  provider: PaymentProvider;
  initPayment(params: {
    amount: number;
    currency: string;
    orderReference: string;
    description: string;
    returnUrl: string;
    callbackUrl: string;
    config: Record<string, string>;
  }): Promise<PaymentInitResult>;
  verifyCallback(
    rawBody: string | Buffer,
    headers: Record<string, string | undefined>,
    config: Record<string, string>
  ): PaymentCallbackResult | null;
  getFinalStatus?(
    providerReference: string,
    config: Record<string, string>
  ): Promise<PaymentCallbackResult | null>;
}

export function verifyLiqPayCallback(
  dataBase64: string,
  signature: string,
  privateKey: string
): boolean {
  const expected = crypto
    .createHash("sha1")
    .update(privateKey + dataBase64 + privateKey)
    .digest("base64");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

export function parseLiqPayData(dataBase64: string) {
  return JSON.parse(Buffer.from(dataBase64, "base64").toString("utf8"));
}

export function verifyMonobankWebhook(
  rawBody: Buffer,
  xSignBase64: string,
  pubKeyPem: string
): boolean {
  const verifier = crypto.createVerify("SHA256");
  verifier.update(rawBody);
  verifier.end();
  return verifier.verify(pubKeyPem, Buffer.from(xSignBase64, "base64"));
}

export function signWayForPay(parts: Array<string | number>, secretKey: string): string {
  const line = parts.join(";");
  return crypto.createHmac("md5", secretKey).update(line, "utf8").digest("hex");
}
