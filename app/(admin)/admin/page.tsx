import Link from "next/link";
import { AlertCircle, CreditCard, Package, Receipt, ShoppingCart, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/checkout/pricing";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";

type AdminDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const nextPath = firstParam(resolvedSearchParams.next) ?? "/admin";
  const hasLoginError = firstParam(resolvedSearchParams.error) === "invalid_admin_password";

  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Internal access
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">KAYER Checkout Admin</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Захищена панель для платежів, доставки, рахунків і операцій KAYER UA.
            </p>
          </div>
          <Card className="bg-card/95 shadow-xl shadow-black/5">
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
            </CardHeader>
            <CardContent>
              <form action="/api/admin/internal-login" method="post" className="space-y-4">
                <input type="hidden" name="next" value={nextPath.startsWith("/admin") ? nextPath : "/admin"} />
                <label className="block space-y-2 text-sm">
                  <span className="font-medium">Admin password</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/30"
                    required
                  />
                </label>
                {hasLoginError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Невірний пароль адміністратора.
                  </p>
                ) : null}
                <Button type="submit" className="h-10 w-full">Увійти в адмінку</Button>
              </form>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Доступ тільки для внутрішньої команди. Shopify install залишено як резервний спосіб підключення.
              </p>
            </CardContent>
          </Card>
          <div className="text-center">
            <Button nativeButton={false} variant="outline" render={<Link href="/api/auth/shopify/install" />}>
              Install on Shopify
            </Button>
          </div>
        </div>
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    paidCount,
    abandonedCount,
    orderCount,
    pendingPayments,
    failedPayments,
    todayRevenue,
    fiscalErrors,
    recentOrders,
  ] = await Promise.all([
    prisma.checkoutSession.count({
      where: { merchantId: session.merchantId, status: "PAID" },
    }),
    prisma.checkoutSession.count({
      where: { merchantId: session.merchantId, status: "ABANDONED" },
    }),
    prisma.orderLink.count({
      where: { checkoutSession: { merchantId: session.merchantId } },
    }),
    prisma.checkoutSession.count({
      where: { merchantId: session.merchantId, status: "PAYMENT_PENDING" },
    }),
    prisma.paymentAttempt.count({
      where: {
        status: "FAILED",
        checkoutSession: { merchantId: session.merchantId },
      },
    }),
    prisma.checkoutSession.aggregate({
      where: {
        merchantId: session.merchantId,
        status: { in: ["PAID", "COMPLETED"] },
        updatedAt: { gte: today },
      },
      _sum: { totalAmount: true },
    }),
    prisma.fiscalReceipt.count({
      where: {
        status: "FAILED",
        orderLink: { checkoutSession: { merchantId: session.merchantId } },
      },
    }),
    prisma.orderLink.findMany({
      where: { checkoutSession: { merchantId: session.merchantId } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { checkoutSession: true, fiscalReceipt: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={merchant?.shopDomain ?? "KAYER UA"}
        title="Dashboard"
        description="Operational overview for checkout sessions, payments, shipping documents and recovery work."
        action={
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} variant="outline" render={<Link href="/admin/orders" />}>
              Orders
            </Button>
            <Button nativeButton={false} render={<Link href="/admin/payments" />}>
              Payments
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Today revenue" value={formatMoney(todayRevenue._sum.totalAmount ?? 0, merchant?.defaultCurrency ?? "UAH")} icon={<TrendingUp className="size-4" />} tone="success" />
        <StatCard label="Paid orders" value={paidCount} helper={`${orderCount} Shopify orders`} icon={<Package className="size-4" />} tone="success" />
        <StatCard label="Pending payments" value={pendingPayments} icon={<CreditCard className="size-4" />} tone="warning" />
        <StatCard label="Failed payments" value={failedPayments} icon={<AlertCircle className="size-4" />} tone={failedPayments ? "danger" : "default"} />
        <StatCard label="Abandoned" value={abandonedCount} icon={<ShoppingCart className="size-4" />} tone="warning" />
        <StatCard label="Fiscal errors" value={fiscalErrors} icon={<Receipt className="size-4" />} tone={fiscalErrors ? "danger" : "default"} />
      </div>

      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
        </CardHeader>
        <CardContent>
          {recentOrders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Fiscal</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      {order.shopifyOrderName ?? order.sourceIdentifier ?? "Pending"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {order.checkoutSession.buyerEmail ?? order.checkoutSession.buyerPhone ?? "Anonymous"}
                    </TableCell>
                    <TableCell><StatusBadge status={order.orderStatus ?? order.checkoutSession.status} /></TableCell>
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
            <EmptyState title="No orders yet" description="Paid checkout sessions will appear here after Shopify order creation." icon={<Package className="size-4" />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
