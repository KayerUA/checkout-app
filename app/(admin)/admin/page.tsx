import Link from "next/link";
import { AlertCircle, CreditCard, LockKeyhole, Package, Receipt, ShoppingCart, TrendingUp } from "lucide-react";

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

function paymentStatusForOrder(order: {
  orderStatus?: string | null;
  checkoutSession: { status: string; paymentProvider?: string | null };
}) {
  if (order.orderStatus === "WAITING_BANK_PAYMENT") return "WAITING_BANK_PAYMENT";
  if (order.orderStatus === "BANK_TRANSFER_PAID" || order.orderStatus === "READY_TO_FULFILL_AFTER_BANK_PAYMENT") {
    return order.orderStatus;
  }
  if (order.checkoutSession.paymentProvider === "BANK_INVOICE" && order.checkoutSession.status === "COMPLETED") {
    return order.orderStatus ?? "WAITING_BANK_PAYMENT";
  }
  return order.checkoutSession.status;
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
      <div className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center py-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(218,183,164,0.3),transparent_26rem)]" />
        <div className="relative w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-[1.35rem] bg-foreground text-background shadow-[0_18px_40px_rgba(20,20,20,0.18)]">
              <LockKeyhole className="size-5" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Внутрішній доступ
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">KAYER Checkout Admin</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Захищена панель для платежів, доставки, рахунків і операцій KAYER UA.
            </p>
          </div>
          <Card className="bg-card/82 shadow-[0_30px_90px_rgba(28,20,16,0.12)] ring-white/70 backdrop-blur-2xl">
            <CardHeader>
              <CardTitle>Вхід</CardTitle>
            </CardHeader>
            <CardContent>
              <form action="/api/admin/internal-login" method="post" className="space-y-4">
                <input type="hidden" name="next" value={nextPath.startsWith("/admin") ? nextPath : "/admin"} />
                <label className="block space-y-2 text-sm">
                  <span className="font-medium">Пароль адміністратора</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    className="h-11 w-full rounded-2xl border border-input bg-background/80 px-3 text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/30"
                    required
                  />
                </label>
                {hasLoginError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Невірний пароль адміністратора.
                  </p>
                ) : null}
                <Button type="submit" className="h-11 w-full rounded-2xl bg-foreground text-background hover:bg-foreground/90">
                  Увійти в адмінку
                </Button>
              </form>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Доступ тільки для внутрішньої команди. Shopify install залишено як резервний спосіб підключення.
              </p>
            </CardContent>
          </Card>
          <div className="text-center">
            <Button
              nativeButton={false}
              variant="outline"
              className="rounded-2xl bg-white/70"
              render={<Link href="/api/auth/shopify/install" />}
            >
              Встановити в Shopify
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
        title="Огляд"
        description="Стан checkout-сесій, платежів, доставки, документів і відновлення замовлень."
        action={
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} variant="outline" render={<Link href="/admin/orders" />}>
              Замовлення
            </Button>
            <Button nativeButton={false} render={<Link href="/admin/payments" />}>
              Платежі
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Виторг сьогодні" value={formatMoney(todayRevenue._sum.totalAmount ?? 0, merchant?.defaultCurrency ?? "UAH")} icon={<TrendingUp className="size-4" />} tone="success" />
        <StatCard label="Оплачені замовлення" value={paidCount} helper={`${orderCount} замовлень Shopify`} icon={<Package className="size-4" />} tone="success" />
        <StatCard label="Платежі в очікуванні" value={pendingPayments} icon={<CreditCard className="size-4" />} tone="warning" />
        <StatCard label="Невдалі платежі" value={failedPayments} icon={<AlertCircle className="size-4" />} tone={failedPayments ? "danger" : "default"} />
        <StatCard label="Покинуті checkout" value={abandonedCount} icon={<ShoppingCart className="size-4" />} tone="warning" />
        <StatCard label="Помилки фіскалізації" value={fiscalErrors} icon={<Receipt className="size-4" />} tone={fiscalErrors ? "danger" : "default"} />
      </div>

      <Card className="bg-card/82 shadow-[0_24px_70px_rgba(28,20,16,0.07)] ring-white/70 backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Останні замовлення</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Останні оплати, очікування та фіскальні події.</p>
            </div>
            <Button nativeButton={false} variant="outline" className="hidden rounded-2xl bg-white/60 sm:inline-flex" render={<Link href="/admin/orders" />}>
              Переглянути всі
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recentOrders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Замовлення</TableHead>
                  <TableHead>Клієнт</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Оплата</TableHead>
                  <TableHead>Фіскалізація</TableHead>
                  <TableHead className="text-right">Сума</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      {order.shopifyOrderName ?? order.sourceIdentifier ?? "Очікує"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {order.checkoutSession.buyerEmail ?? order.checkoutSession.buyerPhone ?? "Без імені"}
                    </TableCell>
                    <TableCell><StatusBadge status={order.orderStatus ?? order.checkoutSession.status} /></TableCell>
                    <TableCell><StatusBadge status={paymentStatusForOrder(order)} /></TableCell>
                    <TableCell><StatusBadge status={order.fiscalReceipt?.status} /></TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(order.checkoutSession.totalAmount, order.checkoutSession.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="Замовлень ще немає" description="Оплачені checkout-сесії зʼявляться тут після створення замовлення Shopify." icon={<Package className="size-4" />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
