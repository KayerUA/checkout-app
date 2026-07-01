import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { getCheckoutAbConfig } from "@/lib/checkout-ab/config";
import {
  computeConversionMetrics,
  getCheckoutAbMetrics,
} from "@/lib/checkout-ab/metrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";

export default async function CheckoutAbPage() {
  try {
    await requireMerchantSession();
  } catch {
    redirect("/admin");
  }

  const config = getCheckoutAbConfig();
  const metrics = await getCheckoutAbMetrics();
  const conversion = computeConversionMetrics(metrics.events);

  const recentEvents = await prisma.checkoutAbEvent.findMany({
    where: { experimentId: config.CHECKOUT_AB_EXPERIMENT_ID },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">A/B Checkout Router</h1>
        <p className="text-sm text-muted-foreground">
          Chekly vs custom checkout — experiment {config.CHECKOUT_AB_EXPERIMENT_ID}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traffic split</CardTitle>
            <CardDescription>Env weights (sticky assignment)</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Chekly: {config.CHEKLY_WEIGHT}%</p>
            <p>Custom: {config.CUSTOM_WEIGHT}%</p>
            <p className="mt-2 text-muted-foreground">
              Kill switch: {config.CUSTOM_CHECKOUT_ENABLED ? "custom ON" : "Chekly only"}
            </p>
          </CardContent>
        </Card>

        {conversion.map((row) => (
          <Card key={row.variant}>
            <CardHeader>
              <CardTitle className="text-base">{row.variant}</CardTitle>
              <CardDescription>Primary: paid / clicks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Clicks: {row.checkoutClicks}</p>
              <p>Paid: {row.paymentSuccess}</p>
              <p>Errors: {row.checkoutErrors}</p>
              <p className="font-medium">
                Conv: {(row.conversionToPaidOrder * 100).toFixed(1)}%
              </p>
              <p className="text-muted-foreground">
                Error rate: {(row.errorRate * 100).toFixed(2)}%
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {recentEvents.map((event) => (
              <div key={event.id} className="flex justify-between border-b py-2">
                <span>
                  <span className="font-medium">{event.eventName}</span>
                  <span className="text-muted-foreground"> · {event.variant}</span>
                </span>
                <span className="text-muted-foreground">
                  {event.createdAt.toISOString().slice(0, 19)}
                </span>
              </div>
            ))}
            {recentEvents.length === 0 && (
              <p className="text-muted-foreground">No events yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
