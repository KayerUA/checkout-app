import { prisma } from "@/lib/db";
import { createShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { notifyPaymentWithoutOrder } from "@/lib/telegram/ops-alerts";

export async function reconcileMissingShopifyOrders(take = 20) {
  const pending = await prisma.checkoutSession.findMany({
    where: { status: "PAID", orderLink: null },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(take, 1), 50),
  });

  const results = [];
  for (const session of pending) {
    try {
      const orderLink = await createShopifyOrderIdempotent(session.id);
      results.push({
        checkoutSessionId: session.id,
        status: "created",
        shopifyOrderName: orderLink.shopifyOrderName,
        shopifyOrderGid: orderLink.shopifyOrderGid,
      });
    } catch (error) {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { checkoutSessionId: session.id, status: "PAID" },
        orderBy: { updatedAt: "desc" },
      });
      if (attempt) {
        await notifyPaymentWithoutOrder({
          provider: attempt.provider,
          amount: attempt.amount,
          currency: session.currency,
          checkoutSessionId: session.id,
          sourceIdentifier: session.sourceIdentifier,
          providerReference: attempt.providerReference,
          retryQueued: true,
        }).catch(() => {});
      }
      results.push({
        checkoutSessionId: session.id,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: pending.length, results };
}
