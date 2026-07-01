import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

export function verifyShopifyWebhookHmac(rawBody: string, hmac: string | null) {
  if (!hmac) return false;
  const env = getEnv();
  const secret = env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_API_SECRET;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return digest.length === hmac.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

export function payloadHash(rawBody: string) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export async function markWebhookProcessing(input: {
  webhookId: string;
  topic: string;
  shopDomain?: string | null;
  rawBody: string;
}) {
  try {
    await prisma.processedWebhook.create({
      data: {
        webhookId: input.webhookId,
        topic: input.topic,
        shopDomain: input.shopDomain,
        payloadHash: payloadHash(input.rawBody),
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") return false;
    const existing = await prisma.processedWebhook.findUnique({
      where: { webhookId: input.webhookId },
    });
    if (existing) return false;
    throw error;
  }
}
