import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { handleB2BOrderCancelled, handleB2BOrderCreated, handleB2BOrderPaid } from "@/lib/b2b/orders";
import { writeAutomationLog } from "@/lib/b2b/log";
import { markWebhookProcessing, verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-security";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";

type SupportedTopic = "orders/create" | "orders/paid" | "orders/cancelled" | "refunds/create";

export async function handleB2BShopifyWebhook(request: NextRequest, expectedTopic: SupportedTopic) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic") ?? expectedTopic;
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? crypto.randomUUID();

  if (topic !== expectedTopic) {
    return NextResponse.json({ error: "Unexpected topic" }, { status: 400 });
  }
  if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  const isNew = await markWebhookProcessing({ webhookId, topic, shopDomain, rawBody });
  if (!isNew) return NextResponse.json({ ok: true, duplicate: true });

  const payload = JSON.parse(rawBody) as ShopifyOrderPayload;
  try {
    if (expectedTopic === "orders/create") {
      await handleB2BOrderCreated(payload, shopDomain);
    } else if (expectedTopic === "orders/paid") {
      await handleB2BOrderPaid(payload, shopDomain);
    } else if (expectedTopic === "orders/cancelled") {
      await handleB2BOrderCancelled(payload, shopDomain);
    } else {
      await writeAutomationLog({
        shopifyOrderId: String(payload.id),
        eventType: expectedTopic,
        step: "refund_seen",
        status: "WARN",
        message: "Refund webhook stored; fiscal correction provider is stubbed for MVP",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    await writeAutomationLog({
      shopifyOrderId: String(payload.id),
      eventType: expectedTopic,
      step: "webhook_handler",
      status: "ERROR",
      message: "B2B Shopify webhook failed",
      error,
    });
    throw error;
  }
}
