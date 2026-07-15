import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import {
  parseLiqPayData,
  verifyLiqPayCallback,
  type PaymentAdapter,
} from "@/lib/payments/types";

export const liqpayAdapter: PaymentAdapter = {
  provider: "LIQPAY",

  async initPayment(params) {
    const { publicKey, privateKey } = params.config;
    const data = {
      version: 3,
      public_key: publicKey,
      action: "pay",
      amount: params.amount / 100,
      currency: params.currency,
      description: params.description,
      order_id: params.orderReference,
      result_url: params.returnUrl,
      server_url: params.callbackUrl,
    };
    const dataBase64 = Buffer.from(JSON.stringify(data)).toString("base64");
    const signature = crypto
      .createHash("sha1")
      .update(privateKey + dataBase64 + privateKey)
      .digest("base64");

    return {
      providerReference: params.orderReference,
      requestPayload: data,
      widgetData: { data: dataBase64, signature },
      redirectUrl: `https://www.liqpay.ua/api/3/checkout?data=${encodeURIComponent(dataBase64)}&signature=${encodeURIComponent(signature)}`,
    };
  },

  verifyCallback(rawBody, _headers, config) {
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString());
    const { data, signature } = body;
    if (!verifyLiqPayCallback(data, signature, config.privateKey)) return null;

    const parsed = parseLiqPayData(data);
    const status =
      parsed.status === "success" || parsed.status === "sandbox"
        ? "PAID"
        : parsed.status === "failure" || parsed.status === "error"
          ? "FAILED"
          : "PENDING";

    return {
      providerReference: parsed.order_id,
      status,
      amount: Math.round(Number(parsed.amount) * 100),
      currency: typeof parsed.currency === "string" ? parsed.currency : undefined,
      modifiedAt: parsed.end_date ? new Date(Number(parsed.end_date)) : undefined,
      rawPayload: parsed,
    };
  },

  async getFinalStatus(providerReference, config) {
    const { publicKey, privateKey } = config;
    const data = {
      version: 3,
      public_key: publicKey,
      action: "status",
      order_id: providerReference,
    };
    const dataBase64 = Buffer.from(JSON.stringify(data)).toString("base64");
    const signature = crypto
      .createHash("sha1")
      .update(privateKey + dataBase64 + privateKey)
      .digest("base64");

    const response = await fetch("https://www.liqpay.ua/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: dataBase64, signature }),
    });

    const parsed = (await response.json()) as Record<string, unknown>;
    const statusValue = String(parsed.status ?? "");
    const status =
      statusValue === "success" || statusValue === "sandbox"
        ? "PAID"
        : statusValue === "failure" || statusValue === "error" || statusValue === "reversed"
          ? "FAILED"
          : "PENDING";

    return {
      providerReference,
      status,
      amount: Math.round(Number(parsed.amount ?? 0) * 100),
      currency: typeof parsed.currency === "string" ? parsed.currency : undefined,
      modifiedAt: parsed.end_date ? new Date(Number(parsed.end_date)) : undefined,
      rawPayload: parsed,
    };
  },
};

export function getLiqPayCallbackUrl() {
  return `${getEnv().APP_URL}/api/callbacks/liqpay`;
}
