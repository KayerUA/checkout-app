import { notFound } from "next/navigation";
import { getCheckoutSessionByToken, serializePublicSession } from "@/lib/checkout/session-service";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { BRAND, CheckoutHeader } from "@/components/checkout/checkout-header";
import { CheckoutFooter } from "@/components/checkout/checkout-footer";
import { Badge } from "@/components/ui/badge";
import { Headphones, ShieldCheck, Store, Truck } from "lucide-react";

export const metadata = {
  title: "Оформлення замовлення — KAYER",
  description: "Безпечне оформлення замовлення на kayer.ua",
};

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getCheckoutSessionByToken(token);
  if (!session) notFound();

  const data = serializePublicSession(session);
  if (!data) notFound();
  const trustItems = [
    { icon: ShieldCheck, label: "Безпечна оплата" },
    { icon: Store, label: "Офіційний магазин" },
    { icon: Headphones, label: "Підтримка клієнтів" },
    { icon: Truck, label: "Доставка по Україні" },
  ];

  return (
    <>
      <CheckoutHeader logoUrl={data.theme?.logoUrl} />
      <main className="flex-1 py-6 sm:py-10">
        <div className="mx-auto mb-6 max-w-6xl px-4 sm:mb-8 sm:px-6">
          <div className="overflow-hidden rounded-3xl border bg-card/90 p-5 shadow-sm shadow-black/5 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="space-y-3">
                <Badge variant="secondary" className="w-fit uppercase tracking-[0.18em]">
                  {BRAND.tagline}
                </Badge>
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
                    Оформлення замовлення KAYER
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Ви у безпечному checkout офіційного магазину KAYER. Заповніть контакти,
                    оберіть Нову Пошту та зручний спосіб оплати.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4 lg:w-[520px]">
                {trustItems.map((item) => {
                  const Icon = item.icon;
                  return (
                  <div key={item.label} className="rounded-2xl border bg-secondary/50 p-3">
                    <Icon className="mb-2 size-4 text-foreground" />
                    <span>{item.label}</span>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <CheckoutForm initial={data as Parameters<typeof CheckoutForm>[0]["initial"]} />
      </main>
      <CheckoutFooter />
    </>
  );
}
