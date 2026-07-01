import { prisma } from "@/lib/db";

export async function recordWebhookDelivery(params: {
  source: string;
  deliveryId: string;
  payload: unknown;
  merchantId?: string;
  eventId?: string;
  verified?: boolean;
}): Promise<boolean> {
  try {
    await prisma.webhookDelivery.create({
      data: {
        source: params.source,
        deliveryId: params.deliveryId,
        eventId: params.eventId,
        merchantId: params.merchantId,
        verified: params.verified ?? false,
        payload: params.payload as object,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function markWebhookProcessed(deliveryId: string, source: string) {
  await prisma.webhookDelivery.update({
    where: { source_deliveryId: { source, deliveryId } },
    data: { processedAt: new Date() },
  });
}

export async function withIdempotency<T>(
  scope: string,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { scope_key: { scope, key } },
  });
  if (existing?.responseSnapshot) {
    return existing.responseSnapshot as T;
  }

  const result = await fn();
  await prisma.idempotencyKey.upsert({
    where: { scope_key: { scope, key } },
    create: {
      scope,
      key,
      responseSnapshot: result as object,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: {
      responseSnapshot: result as object,
    },
  });
  return result;
}
