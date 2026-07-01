import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { recordWebhookDelivery } from "@/lib/idempotency";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const deliveryId = request.headers.get("x-shopify-webhook-id") ?? crypto.randomUUID();

  if (!hmac) {
    return NextResponse.json({ error: "Missing HMAC" }, { status: 401 });
  }

  const digest = crypto
    .createHmac("sha256", getEnv().SHOPIFY_API_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  const valid =
    digest.length === hmac.length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  if (!valid) {
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  const isNew = await recordWebhookDelivery({
    source: "shopify",
    deliveryId,
    payload: JSON.parse(rawBody),
    verified: true,
    eventId: topic ?? undefined,
  });

  if (!isNew) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (topic === "app/uninstalled") {
    const body = JSON.parse(rawBody);
    const { prisma } = await import("@/lib/db");
    await prisma.merchant.updateMany({
      where: { shopDomain: body.myshopify_domain ?? body.domain },
      data: { status: "UNINSTALLED" },
    });
  }

  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
