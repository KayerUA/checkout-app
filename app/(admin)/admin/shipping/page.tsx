import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShippingConfigForm } from "@/components/admin/shipping-config-form";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function ShippingPage() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    redirect("/admin?next=/admin/shipping");
  }

  const novaPoshta = await prisma.shippingProviderConfig.findUnique({
    where: {
      merchantId_provider: {
        merchantId: session.merchantId,
        provider: "nova_poshta",
      },
    },
  });
  const config = (novaPoshta?.config ?? {}) as {
    flatRateKopiyky?: number;
    apiKey?: string;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Доставка</h1>
        <p className="text-sm text-muted-foreground">Нова Пошта — відділення та поштомати</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Нова Пошта</CardTitle>
          <CardDescription>
            Фіксований тариф доставки та синхронізація довідника міст/відділень.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShippingConfigForm
            initial={{
              isEnabled: novaPoshta?.isEnabled ?? true,
              flatRateKopiyky: config.flatRateKopiyky ?? 9000,
              hasApiKey: Boolean(config.apiKey),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
