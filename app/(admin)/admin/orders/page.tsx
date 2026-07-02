import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-zinc-500">
            Відновлення створює Shopify orders для оплачених checkout sessions без order link.
          </p>
        </div>
        <form action="/api/admin/reconcile-orders" method="post">
          <Button type="submit" variant="outline">Create missing Shopify orders</Button>
        </form>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Shopify order links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {orders.map((o) => (
              <div
                key={o.id}
                className="rounded-lg border border-zinc-200 p-3 text-sm"
              >
                <p className="font-medium">{o.shopifyOrderName ?? "Pending"}</p>
                <p className="text-zinc-500">
                  Session {o.checkoutSession.publicToken.slice(0, 8)}… · Fiscal:{" "}
                  {o.fiscalReceipt?.status ?? "n/a"}
                </p>
              </div>
            ))}
            {orders.length === 0 && (
              <p className="text-zinc-500">No orders yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
