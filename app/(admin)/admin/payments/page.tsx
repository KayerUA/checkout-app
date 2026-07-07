import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PaymentConfigForm } from "@/components/admin/payment-config-form";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { CreditCard, ShieldCheck, XCircle } from "lucide-react";

export default async function PaymentsPage() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    redirect("/admin");
  }

  const liqpay = await prisma.paymentProviderConfig.findUnique({
    where: {
      merchantId_provider: {
        merchantId: session.merchantId,
        provider: "LIQPAY",
      },
    },
  });
  const liqpayConfig = (liqpay?.config ?? {}) as Record<string, string>;
  const [pendingCount, failedCount] = await Promise.all([
    prisma.paymentAttempt.count({
      where: { status: "PENDING", checkoutSession: { merchantId: session.merchantId } },
    }),
    prisma.paymentAttempt.count({
      where: { status: "FAILED", checkoutSession: { merchantId: session.merchantId } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="LiqPay card checkout status, keys and reconciliation for pending payments."
        action={
        <form action="/api/admin/reconcile-payments" method="post">
          <Button type="submit" variant="outline">Check LiqPay pending payments</Button>
        </form>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="LiqPay status" value={liqpay?.isEnabled ? "Enabled" : "Disabled"} icon={<ShieldCheck className="size-4" />} tone={liqpay?.isEnabled ? "success" : "warning"} />
        <StatCard label="Pending attempts" value={pendingCount} icon={<CreditCard className="size-4" />} tone="warning" />
        <StatCard label="Failed attempts" value={failedCount} icon={<XCircle className="size-4" />} tone={failedCount ? "danger" : "default"} />
      </div>
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>LiqPay</CardTitle>
          <CardDescription>
            Вкажіть ключі з кабінету LiqPay. Callback URL вказується автоматично нижче.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentConfigForm
            initial={{
              isEnabled: liqpay?.isEnabled ?? false,
              isSandbox: liqpay?.isSandbox ?? true,
              publicKey: liqpayConfig.publicKey ?? "",
              hasPrivateKey: Boolean(liqpayConfig.privateKey),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
