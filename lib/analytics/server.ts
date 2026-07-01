import { prisma } from "@/lib/db";
import type { CheckoutSession, OrderLink } from "@prisma/client";

export async function sendPurchaseAnalytics(
  merchantId: string,
  session: CheckoutSession,
  orderLink: OrderLink
) {
  const config = await prisma.analyticsConfig.findUnique({
    where: { merchantId },
  });
  if (!config) return;

  const event = {
    transaction_id: orderLink.id,
    value: session.totalAmount / 100,
    currency: session.currency,
    items: [],
  };

  if (config.ga4MeasurementId && process.env.GA4_API_SECRET) {
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${config.ga4MeasurementId}&api_secret=${process.env.GA4_API_SECRET}`,
      {
        method: "POST",
        body: JSON.stringify({
          client_id: session.publicToken,
          events: [{ name: "purchase", params: event }],
        }),
      }
    ).catch(() => null);
  }

  if (config.metaPixelId && config.metaAccessToken) {
    await fetch(
      `https://graph.facebook.com/v18.0/${config.metaPixelId}/events?access_token=${config.metaAccessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [
            {
              event_name: "Purchase",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              custom_data: {
                currency: session.currency,
                value: session.totalAmount / 100,
                order_id: orderLink.shopifyOrderName,
              },
            },
          ],
        }),
      }
    ).catch(() => null);
  }
}

export async function emitServerCheckoutEvent(
  merchantId: string,
  eventName: string,
  sessionId: string,
  value?: number
) {
  const config = await prisma.analyticsConfig.findUnique({ where: { merchantId } });
  if (!config?.ga4MeasurementId || !process.env.GA4_API_SECRET) return;

  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${config.ga4MeasurementId}&api_secret=${process.env.GA4_API_SECRET}`,
    {
      method: "POST",
      body: JSON.stringify({
        client_id: sessionId,
        events: [{ name: eventName, params: { value } }],
      }),
    }
  ).catch(() => null);
}
