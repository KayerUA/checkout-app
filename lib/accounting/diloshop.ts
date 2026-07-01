import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { writeAutomationLog } from "@/lib/b2b/log";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";

function getWebhookUrl() {
  const env = getEnv();
  if (env.DILOSHOP_WEBHOOK_URL) return env.DILOSHOP_WEBHOOK_URL;
  if (env.DILOSHOP_API_URL) {
    return `${env.DILOSHOP_API_URL.replace(/\/$/, "")}/webhooks/shopify/orders-dilovod`;
  }
  return null;
}

function hmacBase64(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function appendTags(existing: string | undefined, tags: string[]) {
  const set = new Set(
    (existing ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  );
  tags.forEach((tag) => set.add(tag));
  return Array.from(set).join(", ");
}

export async function notifyDiloshopOrderReady(input: {
  order: ShopifyOrderPayload;
  shopDomain?: string | null;
  transactionId: string;
}) {
  const env = getEnv();
  if (env.ACCOUNTING_PROVIDER !== "diloshop") return { skipped: true, reason: "provider_disabled" };

  const webhookUrl = getWebhookUrl();
  const secret = env.DILOSHOP_WEBHOOK_SECRET;
  if (!webhookUrl || !secret) {
    await writeAutomationLog({
      shopifyOrderId: String(input.order.id),
      eventType: "diloshop/notify",
      step: "config",
      status: "WARN",
      message: "Diloshop webhook is not configured",
    });
    return { skipped: true, reason: "missing_config" };
  }

  const payload: ShopifyOrderPayload & Record<string, unknown> = {
    ...input.order,
    financial_status: "paid",
    tags: appendTags(input.order.tags, [
      "B2B_FOP",
      "BANK_TRANSFER_PAID",
      "PAYMENT_CONFIRMED",
      "diloshop_ready",
    ]),
    note_attributes: [
      ...(input.order.note_attributes ?? []),
      { name: "kayer_b2b_bank_transaction_id", value: input.transactionId },
      { name: "kayer_b2b_payment_status", value: "BANK_TRANSFER_PAID" },
    ],
  };

  const rawBody = JSON.stringify(payload);
  const webhookId = `kayer-b2b-bank-paid-${input.order.id}-${input.transactionId}`;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmacBase64(secret, rawBody),
      "X-Shopify-Topic": "orders/paid",
      "X-Shopify-Shop-Domain": input.shopDomain ?? env.SHOPIFY_SHOP_DOMAIN ?? "",
      "X-Shopify-Webhook-Id": webhookId,
    },
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(`Diloshop webhook failed: ${response.status} ${await response.text()}`);
  }

  await writeAutomationLog({
    shopifyOrderId: String(input.order.id),
    eventType: "diloshop/notify",
    step: "orders_paid_forward",
    status: "OK",
    message: "B2B bank-paid order forwarded to Diloshop",
    metadata: { webhookId },
  });

  return { ok: true, webhookId };
}
