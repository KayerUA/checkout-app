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
  if (env.DILOSHOP_NP_WEBHOOK_URL) return env.DILOSHOP_NP_WEBHOOK_URL;
  if (env.DILOSHOP_API_URL) {
    return `${env.DILOSHOP_API_URL.replace(/\/$/, "")}/webhook/nova-poshta`;
  }
  return null;
}

function hmacBase64(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

async function postDiloshopWebhook(input: {
  url: string;
  secret?: string | null;
  flowSecret?: string | null;
  topic: string;
  shopDomain?: string | null;
  webhookId: string;
  payload: ShopifyOrderPayload;
}) {
  const rawBody = JSON.stringify(input.payload);
  const authHeaders: Record<string, string> = {};
  if (input.flowSecret) {
    authHeaders["X-Flow-Secret"] = input.flowSecret;
  } else if (input.secret) {
    authHeaders["X-Shopify-Hmac-Sha256"] = hmacBase64(input.secret, rawBody);
  }
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
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
  targets?: {
    orders?: boolean;
    novaPoshta?: boolean;
  };
}) {
  const env = getEnv();
  if (env.ACCOUNTING_PROVIDER !== "diloshop") {
    return { skipped: true, reason: "provider_disabled" as const };
  }

  const secret = env.DILOSHOP_WEBHOOK_SECRET || env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_API_SECRET;
  const npFlowSecret = env.DILOSHOP_NP_FLOW_SECRET;
  const forwardOrders = input.targets?.orders ?? true;
  const forwardNovaPoshta = input.targets?.novaPoshta ?? true;
  const ordersUrl = forwardOrders ? getOrdersWebhookUrl() : null;
  const npUrl = forwardNovaPoshta ? getNovaPoshtaWebhookUrl() : null;
  const missingOrdersAuth = forwardOrders && !secret;
  const missingNovaPoshtaAuth = forwardNovaPoshta && !secret && !npFlowSecret;

  if (missingOrdersAuth || missingNovaPoshtaAuth || (!ordersUrl && !npUrl)) {
    await writeAutomationLog({
      shopifyOrderId: String(input.order.id),
      eventType: "diloshop/forward",
      step: "config",
      status: "WARN",
      message: "Diloshop forward is not configured",
      metadata: {
        targets: { orders: forwardOrders, novaPoshta: forwardNovaPoshta },
        ordersUrl: Boolean(ordersUrl),
        npUrl: Boolean(npUrl),
        missingOrdersAuth,
        missingNovaPoshtaAuth,
      },
    });
    return { skipped: true, reason: "missing_config" as const };
  }

  const shopDomain = input.shopDomain ?? env.SHOPIFY_SHOP_DOMAIN ?? "";
  const orderId = String(input.order.id);
  const errors: string[] = [];

  if (ordersUrl) {
    if (!secret) {
      errors.push("orders-dilovod skipped: missing Shopify HMAC secret");
    } else {
      for (const topic of ["orders/create", "orders/paid"] as const) {
        try {
          await postDiloshopWebhook({
            url: ordersUrl,
            secret,
            topic,
            shopDomain,
            webhookId: `kayer-checkout-${topic.endsWith("create") ? "create" : "paid"}-${orderId}-${input.checkoutSessionId}`,
            payload: input.order,
          });
        } catch (error) {
          errors.push(`${topic}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  if (npUrl) {
    try {
      await postDiloshopWebhook({
        url: npUrl,
        secret: npFlowSecret ? null : secret,
        flowSecret: npFlowSecret,
        topic: "orders/paid",
        shopDomain,
        webhookId: `kayer-checkout-np-${orderId}-${input.checkoutSessionId}`,
        payload: input.order,
      });
    } catch (error) {
      errors.push(`nova-poshta: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length) {
    await writeAutomationLog({
      shopifyOrderId: orderId,
      eventType: "diloshop/forward",
      step: "external_checkout_paid",
      status: "ERROR",
      message: "External checkout forward failed",
      metadata: {
        targets: { orders: forwardOrders, novaPoshta: forwardNovaPoshta },
        ordersUrl: Boolean(ordersUrl),
        npUrl: Boolean(npUrl),
        errors,
      },
    });
    throw new Error(errors.join("; "));
  }

  await writeAutomationLog({
    shopifyOrderId: orderId,
    eventType: "diloshop/forward",
    step: "external_checkout_paid",
    status: "OK",
    message: "External checkout order forwarded to Diloshop (Dilovod + Nova Poshta)",
    metadata: {
      targets: { orders: forwardOrders, novaPoshta: forwardNovaPoshta },
      ordersUrl: Boolean(ordersUrl),
      npUrl: Boolean(npUrl),
    },
  });

  return { ok: true as const };
}
