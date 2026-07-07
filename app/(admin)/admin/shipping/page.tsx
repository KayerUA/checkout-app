import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title="Shipping"
        description="Нова Пошта — відділення та поштомати. Checkout не додає доставку до B2B invoice."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
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
