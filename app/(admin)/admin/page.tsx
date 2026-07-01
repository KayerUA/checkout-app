import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function AdminDashboardPage() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">UA Checkout Admin</h1>
        <p className="text-zinc-600">
          Connect your Shopify store to get started.
        </p>
        <Button nativeButton={false} render={<Link href="/api/auth/shopify/install" />}>
          Install on Shopify
        </Button>
      </div>
    );
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.merchantId },
    include: {
      _count: {
        select: {
          checkoutSessions: true,
        },
      },
    },
  });

  const [paidCount, abandonedCount, orderCount] = await Promise.all([
    prisma.checkoutSession.count({
      where: { merchantId: session.merchantId, status: "PAID" },
    }),
    prisma.checkoutSession.count({
      where: { merchantId: session.merchantId, status: "ABANDONED" },
    }),
    prisma.orderLink.count({
      where: { checkoutSession: { merchantId: session.merchantId } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-zinc-600">{merchant?.shopDomain}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{merchant?._count.checkoutSessions ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{paidCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Abandoned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{abandonedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Shopify Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{orderCount}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
