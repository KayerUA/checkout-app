import crypto from "node:crypto";
import { writeAutomationLog } from "@/lib/b2b/log";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

const DISPATCH_SCOPE = "diloshop-np-fallback";
const DISPATCH_LEASE_MS = 5 * 60 * 1000;
const SENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

function hmacBase64(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

export function isDiloshopNovaPoshtaFallbackConfigured() {
  return Boolean(getEnv().DILOSHOP_NP_WEBHOOK_URL);
}

async function claimDispatch(key: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + DISPATCH_LEASE_MS);

  try {
    await prisma.idempotencyKey.create({
      data: {
        scope: DISPATCH_SCOPE,
        key,
        responseSnapshot: { status: "PROCESSING" },
        expiresAt: leaseExpiresAt,
      },
    });
    return true;
  } catch {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope: DISPATCH_SCOPE, key } },
    });
    const status = (existing?.responseSnapshot as { status?: string } | null)?.status;
    if (!existing || status === "SENT") return false;

    const reclaimed = await prisma.idempotencyKey.updateMany({
      where: {
        id: existing.id,
        expiresAt: { lt: now },
      },
      data: {
        responseSnapshot: { status: "PROCESSING" },
        expiresAt: leaseExpiresAt,
      },
    });
    return reclaimed.count === 1;
  }
}

async function releaseDispatch(key: string) {
  await prisma.idempotencyKey.updateMany({
    where: { scope: DISPATCH_SCOPE, key },
    data: {
      responseSnapshot: { status: "FAILED" },
      expiresAt: new Date(0),
    },
  });
}

export async function notifyDiloshopNovaPoshtaFallback(input: {
  order: ShopifyOrderPayload;
  shopDomain?: string | null;
  checkoutSessionId: string;
}) {
  const env = getEnv();
  const url = env.DILOSHOP_NP_WEBHOOK_URL;
  if (!url) return { skipped: true as const, reason: "missing_url" as const };

  const flowSecret = env.DILOSHOP_NP_FLOW_SECRET;
  const hmacSecret =
    env.DILOSHOP_WEBHOOK_SECRET || env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_API_SECRET;
  if (!flowSecret && !hmacSecret) {
    await writeAutomationLog({
      shopifyOrderId: String(input.order.id),
      eventType: "diloshop/nova-poshta",
      step: "fallback_config",
      status: "WARN",
      message: "Diloshop Nova Poshta fallback has no authentication secret",
      metadata: { checkoutSessionId: input.checkoutSessionId },
    }).catch(() => {});
    return { skipped: true as const, reason: "missing_auth" as const };
  }

  const orderId = String(input.order.id);
  const dispatchKey = `${orderId}:${input.checkoutSessionId}`;
  const webhookId = `kayer-checkout-np-${dispatchKey}`;
  const claimed = await claimDispatch(dispatchKey);
  if (!claimed) {
    return { skipped: true as const, reason: "already_dispatched" as const, webhookId };
  }

  const rawBody = JSON.stringify(input.order);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(flowSecret
          ? { "X-Flow-Secret": flowSecret }
          : { "X-Shopify-Hmac-Sha256": hmacBase64(hmacSecret, rawBody) }),
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Shop-Domain": input.shopDomain ?? env.SHOPIFY_SHOP_DOMAIN ?? "",
        "X-Shopify-Webhook-Id": webhookId,
      },
      body: rawBody,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const responseText = (await response.text()).slice(0, 1000);
      throw new Error(
        `Diloshop Nova Poshta webhook failed: ${response.status} ${responseText}`
      );
    }

    await prisma.idempotencyKey.update({
      where: { scope_key: { scope: DISPATCH_SCOPE, key: dispatchKey } },
      data: {
        responseSnapshot: { status: "SENT", webhookId },
        expiresAt: new Date(Date.now() + SENT_RETENTION_MS),
      },
    });
  } catch (error) {
    await releaseDispatch(dispatchKey);
    await writeAutomationLog({
      shopifyOrderId: orderId,
      eventType: "diloshop/nova-poshta",
      step: "fallback_dispatch",
      status: "ERROR",
      message: "Diloshop Nova Poshta fallback failed",
      error,
      metadata: { checkoutSessionId: input.checkoutSessionId, webhookId },
    }).catch(() => {});
    throw error;
  }

  await writeAutomationLog({
    shopifyOrderId: orderId,
    eventType: "diloshop/nova-poshta",
    step: "fallback_dispatch",
    status: "OK",
    message: "Order sent to the Diloshop Nova Poshta fallback",
    metadata: { checkoutSessionId: input.checkoutSessionId, webhookId },
  }).catch(() => {});

  return { ok: true as const, webhookId };
}
