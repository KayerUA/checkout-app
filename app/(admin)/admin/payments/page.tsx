import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentConfigForm } from "@/components/admin/payment-config-form";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { redirect } from "next/navigation";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Оплата</h1>
        <p className="text-sm text-muted-foreground">LiqPay — єдиний спосіб оплати для kayer.ua</p>
      </div>
      <Card>
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
