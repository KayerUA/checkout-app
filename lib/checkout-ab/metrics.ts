import { prisma } from "@/lib/db";
import { getCheckoutAbConfig } from "@/lib/checkout-ab/config";

export async function getCheckoutAbMetrics(experimentId?: string) {
  const config = getCheckoutAbConfig();
  const expId = experimentId ?? config.CHECKOUT_AB_EXPERIMENT_ID;

  const [eventsByVariant, assignmentsByVariant] = await Promise.all([
    prisma.checkoutAbEvent.groupBy({
      by: ["variant", "eventName"],
      where: { experimentId: expId },
      _count: { _all: true },
    }),
    prisma.checkoutAbAssignment.groupBy({
      by: ["variant"],
      where: { experimentId: expId },
      _count: { _all: true },
    }),
  ]);

  const revenueByVariant = await prisma.checkoutAbEvent.groupBy({
    by: ["variant"],
    where: {
      experimentId: expId,
      eventName: { in: ["payment_success", "shopify_order_created"] },
      revenue: { not: null },
    },
    _sum: { revenue: true },
  });

  return {
    experimentId: expId,
    weights: {
      chekly: config.CHEKLY_WEIGHT,
      custom: config.CUSTOM_WEIGHT,
    },
    customCheckoutEnabled: config.CUSTOM_CHECKOUT_ENABLED,
    assignments: assignmentsByVariant,
    events: eventsByVariant,
    revenue: revenueByVariant,
  };
}

export function computeConversionMetrics(
  events: Array<{ variant: string; eventName: string; _count: { _all: number } }>
) {
  const byVariant: Record<string, Record<string, number>> = {};

  for (const row of events) {
    if (!byVariant[row.variant]) byVariant[row.variant] = {};
    byVariant[row.variant][row.eventName] = row._count._all;
  }

  return Object.entries(byVariant).map(([variant, counts]) => {
    const clicks = counts.checkout_click ?? 0;
    const paid = counts.payment_success ?? counts.shopify_order_created ?? 0;
    const errors = counts.checkout_error ?? 0;
    return {
      variant,
      checkoutClicks: clicks,
      paymentSuccess: paid,
      checkoutErrors: errors,
      conversionToPaidOrder: clicks > 0 ? paid / clicks : 0,
      errorRate: clicks > 0 ? errors / clicks : 0,
    };
  });
}
