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
  currency?: string;
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
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

export function parseLiqPayCallbackEnvelope(rawBody: string | Buffer) {
  const bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    if (typeof parsed.data === "string" && typeof parsed.signature === "string") {
      return { data: parsed.data, signature: parsed.signature };
    }
  } catch {
    // LiqPay sends callbacks as POST form fields, not as a JSON document.
  }

  const form = new URLSearchParams(bodyText);
  const data = form.get("data");
  const signature = form.get("signature");
  return data && signature ? { data, signature } : null;
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
