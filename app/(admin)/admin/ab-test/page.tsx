import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { getCheckoutAbConfig } from "@/lib/checkout-ab/config";
import {
  computeConversionMetrics,
  getCheckoutAbMetrics,
} from "@/lib/checkout-ab/metrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlaskConical } from "lucide-react";

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
      <PageHeader
        title="A/B Checkout"
        description={`Chekly vs custom checkout. Experiment ${config.CHECKOUT_AB_EXPERIMENT_ID}.`}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/95 shadow-sm shadow-black/5">
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
          <Card key={row.variant} className="bg-card/95 shadow-sm shadow-black/5">
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

      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          {recentEvents.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Visitor</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">{event.eventName}</TableCell>
                    <TableCell><StatusBadge status={event.variant} /></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{event.visitorId.slice(0, 12)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {event.createdAt.toISOString().slice(0, 19)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="No events yet" description="Checkout router events will appear here after traffic reaches the experiment." icon={<FlaskConical className="size-4" />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
