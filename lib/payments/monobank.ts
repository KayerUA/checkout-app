import { getEnv } from "@/lib/env";
import { verifyMonobankWebhook, type PaymentAdapter } from "@/lib/payments/types";

let cachedPubKey: string | null = null;

async function getMonobankPubKey(token: string): Promise<string> {
  if (cachedPubKey) return cachedPubKey;
  const res = await fetch("https://api.monobank.ua/api/merchant/pubkey", {
    headers: { "X-Token": token },
  });
  if (!res.ok) throw new Error("Failed to fetch Monobank pubkey");
  const data = await res.json();
  cachedPubKey = data.key as string;
  return cachedPubKey;
}

export const monobankAdapter: PaymentAdapter = {
  provider: "MONOBANK",

  async initPayment(params) {
    const token = params.config.token;
    const body = {
      amount: params.amount,
      ccy: 980,
      merchantPaymInfo: {
        reference: params.orderReference,
        destination: params.description,
      },
      redirectUrl: params.returnUrl,
      webHookUrl: params.callbackUrl,
    };

    const res = await fetch("https://api.monobank.ua/api/merchant/invoice/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token": token,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Monobank invoice create failed: ${err}`);
    }

    const data = await res.json();
    return {
      providerReference: data.invoiceId as string,
      requestPayload: body,
      redirectUrl: data.pageUrl as string,
    };
  },

  verifyCallback(rawBody, headers) {
    const xSign = headers["x-sign"];
    if (!xSign) return null;

    const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const parsed = JSON.parse(bodyBuf.toString());
    const status =
      parsed.status === "success" ? "PAID" : parsed.status === "failure" ? "FAILED" : "PENDING";

    return {
      providerReference: parsed.invoiceId as string,
      status,
      amount: parsed.amount as number,
      currency: Number(parsed.ccy) === 980 ? "UAH" : undefined,
      modifiedAt: parsed.modifiedDate ? new Date(parsed.modifiedDate) : undefined,
      rawPayload: parsed,
    };
  },

  async getFinalStatus(providerReference, config) {
    const res = await fetch(
      `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${providerReference}`,
      { headers: { "X-Token": config.token } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const status =
      data.status === "success" ? "PAID" : data.status === "failure" ? "FAILED" : "PENDING";
    return {
      providerReference,
      status,
      amount: data.amount as number,
      currency: Number(data.ccy) === 980 ? "UAH" : undefined,
      modifiedAt: data.modifiedDate ? new Date(data.modifiedDate) : undefined,
      rawPayload: data,
    };
  },
};

export async function verifyMonobankCallback(
  rawBody: Buffer,
  xSign: string,
  token: string
): Promise<boolean> {
  const pubKey = await getMonobankPubKey(token);
  return verifyMonobankWebhook(rawBody, xSign, pubKey);
}

export function getMonobankCallbackUrl() {
  return `${getEnv().APP_URL}/api/callbacks/monobank`;
}
