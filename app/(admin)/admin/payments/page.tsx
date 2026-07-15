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
        title="Платежі"
        description="Стан карткових оплат LiqPay, ключі та звірка платежів в очікуванні."
        action={
        <form action="/api/admin/reconcile-payments" method="post">
          <Button type="submit" variant="outline">Перевірити платежі LiqPay</Button>
        </form>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Стан LiqPay" value={liqpay?.isEnabled ? "Увімкнено" : "Вимкнено"} icon={<ShieldCheck className="size-4" />} tone={liqpay?.isEnabled ? "success" : "warning"} />
        <StatCard label="В очікуванні" value={pendingCount} icon={<CreditCard className="size-4" />} tone="warning" />
        <StatCard label="Невдалі спроби" value={failedCount} icon={<XCircle className="size-4" />} tone={failedCount ? "danger" : "default"} />
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
