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

const WEBHOOK_LEASE_MS = 5 * 60 * 1000;

export async function claimWebhookProcessing(input: {
  webhookId: string;
  topic: string;
  shopDomain?: string | null;
  rawBody: string;
}) {
  const leaseExpiresAt = new Date(Date.now() + WEBHOOK_LEASE_MS);
  try {
    await prisma.processedWebhook.create({
      data: {
        webhookId: input.webhookId,
        topic: input.topic,
        shopDomain: input.shopDomain,
        payloadHash: payloadHash(input.rawBody),
        status: "PROCESSING",
        attempts: 1,
        leaseExpiresAt,
      },
    });
    return "ACQUIRED" as const;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2002")) {
      throw error;
    }
    const existing = await prisma.processedWebhook.findUnique({
      where: { webhookId: input.webhookId },
    });
    if (!existing) throw error;
    if (existing.status === "COMPLETED") return "COMPLETED" as const;
    if (
      existing.status === "PROCESSING" &&
      existing.leaseExpiresAt &&
      existing.leaseExpiresAt > new Date()
    ) {
      return "BUSY" as const;
    }
    const claimed = await prisma.processedWebhook.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: "FAILED" },
          { status: "PROCESSING", leaseExpiresAt: { lte: new Date() } },
          { status: "PROCESSING", leaseExpiresAt: null },
        ],
      },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
        lastError: null,
        leaseExpiresAt,
        payloadHash: payloadHash(input.rawBody),
      },
    });
    return claimed.count === 1 ? "ACQUIRED" as const : "BUSY" as const;
  }
}

export async function completeWebhookProcessing(webhookId: string) {
  await prisma.processedWebhook.update({
    where: { webhookId },
    data: {
      status: "COMPLETED",
      processedAt: new Date(),
      leaseExpiresAt: null,
      lastError: null,
    },
  });
}

export async function failWebhookProcessing(webhookId: string) {
  await prisma.processedWebhook.updateMany({
    where: { webhookId, status: "PROCESSING" },
    data: {
      status: "FAILED",
      leaseExpiresAt: null,
      lastError: "Webhook handler failed; retry is allowed",
    },
  });
}
