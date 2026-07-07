import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/checkout/pricing";
import { Package } from "lucide-react";

export default async function OrdersPage() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    redirect("/admin");
  }

  const orders = await prisma.orderLink.findMany({
    where: { checkoutSession: { merchantId: session.merchantId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      checkoutSession: true,
      fiscalReceipt: true,
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Shopify order links, payment state and fiscalization status for the latest checkout sessions."
        action={
        <form action="/api/admin/reconcile-orders" method="post">
          <Button type="submit" variant="outline">Create missing Shopify orders</Button>
        </form>
        }
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Shopify order links</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fiscal</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.shopifyOrderName ?? "Pending"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {order.checkoutSession.publicToken.slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {order.checkoutSession.buyerEmail ?? order.checkoutSession.buyerPhone ?? "Anonymous"}
                    </TableCell>
                    <TableCell><StatusBadge status={order.checkoutSession.status} /></TableCell>
                    <TableCell><StatusBadge status={order.fiscalReceipt?.status} /></TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(order.checkoutSession.totalAmount, order.checkoutSession.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="No orders yet" description="When paid checkouts create Shopify orders, they will appear here." icon={<Package className="size-4" />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
