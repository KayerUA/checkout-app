import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
      <div className="mx-auto max-w-lg space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">KAYER Checkout Admin</h1>
          <p className="text-zinc-600">Увійдіть у внутрішню панель, щоб налаштувати LiqPay.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Internal access</CardTitle>
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
                  className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                  required
                />
              </label>
              {hasLoginError && (
                <p className="text-sm text-red-600">Невірний пароль адміністратора.</p>
              )}
              <Button type="submit">Увійти</Button>
            </form>
          </CardContent>
        </Card>
        <div className="border-t pt-4">
          <p className="mb-3 text-sm text-zinc-500">
            Shopify OAuth install залишено як резервний спосіб підключення.
          </p>
          <Button nativeButton={false} variant="outline" render={<Link href="/api/auth/shopify/install" />}>
            Install on Shopify
          </Button>
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
