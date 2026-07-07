import crypto from "node:crypto";
import { writeAutomationLog } from "@/lib/b2b/log";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";
import { getEnv } from "@/lib/env";

function getOrdersWebhookUrl() {
  const env = getEnv();
  if (env.DILOSHOP_WEBHOOK_URL) return env.DILOSHOP_WEBHOOK_URL;
  if (env.DILOSHOP_API_URL) {
    return `${env.DILOSHOP_API_URL.replace(/\/$/, "")}/webhooks/shopify/orders-dilovod`;
  }
  return null;
}

function getNovaPoshtaWebhookUrl() {
  const env = getEnv();
  return env.DILOSHOP_NP_WEBHOOK_URL ?? null;
}

function hmacBase64(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

async function postDiloshopWebhook(input: {
  url: string;
  secret: string;
  topic: string;
  shopDomain?: string | null;
  webhookId: string;
  payload: ShopifyOrderPayload;
}) {
  const rawBody = JSON.stringify(input.payload);
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmacBase64(input.secret, rawBody),
      "X-Shopify-Topic": input.topic,
      "X-Shopify-Shop-Domain": input.shopDomain ?? getEnv().SHOPIFY_SHOP_DOMAIN ?? "",
      "X-Shopify-Webhook-Id": input.webhookId,
    },
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(`Diloshop webhook failed: ${response.status} ${await response.text()}`);
  }
}

export async function forwardExternalCheckoutOrderToDiloshop(input: {
  order: ShopifyOrderPayload;
  shopDomain?: string | null;
  checkoutSessionId: string;
}) {
  const env = getEnv();
  if (env.ACCOUNTING_PROVIDER !== "diloshop") {
    return { skipped: true, reason: "provider_disabled" as const };
  }

  const secret = env.DILOSHOP_WEBHOOK_SECRET;
  const ordersUrl = getOrdersWebhookUrl();
  const npUrl = getNovaPoshtaWebhookUrl();
  if (!secret || (!ordersUrl && !npUrl)) {
    await writeAutomationLog({
      shopifyOrderId: String(input.order.id),
      eventType: "diloshop/forward",
      step: "config",
      status: "WARN",
      message: "Diloshop forward is not configured",
    });
    return { skipped: true, reason: "missing_config" as const };
  }

  const shopDomain = input.shopDomain ?? env.SHOPIFY_SHOP_DOMAIN ?? "";
  const orderId = String(input.order.id);

  if (ordersUrl) {
    await postDiloshopWebhook({
      url: ordersUrl,
      secret,
      topic: "orders/create",
      shopDomain,
      webhookId: `kayer-checkout-create-${orderId}-${input.checkoutSessionId}`,
      payload: input.order,
    });
    await postDiloshopWebhook({
      url: ordersUrl,
      secret,
      topic: "orders/paid",
      shopDomain,
      webhookId: `kayer-checkout-paid-${orderId}-${input.checkoutSessionId}`,
      payload: input.order,
    });
  }

  if (npUrl) {
    await postDiloshopWebhook({
      url: npUrl,
      secret,
      topic: "orders/paid",
      shopDomain,
      webhookId: `kayer-checkout-np-${orderId}-${input.checkoutSessionId}`,
      payload: input.order,
    });
  }

  await writeAutomationLog({
    shopifyOrderId: orderId,
    eventType: "diloshop/forward",
    step: "external_checkout_paid",
    status: "OK",
    message: "External checkout order forwarded to Diloshop",
    metadata: {
      ordersUrl: Boolean(ordersUrl),
      npUrl: Boolean(npUrl),
    },
  });

  return { ok: true as const };
}
