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
      <main className="relative flex-1 overflow-hidden py-5 sm:py-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,rgba(232,205,190,0.65),transparent_62%)]" />
        <div className="relative mx-auto mb-5 max-w-6xl px-4 sm:mb-7 sm:px-6">
          <div className="rounded-[2rem] border bg-card/70 p-4 shadow-sm shadow-black/5 backdrop-blur sm:p-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="space-y-2">
                <Badge variant="secondary" className="w-fit uppercase tracking-[0.18em]">
                  {BRAND.tagline}
                </Badge>
                <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">
                  Оформлення замовлення KAYER
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Спокійний checkout офіційного магазину: контакти, Нова Пошта, оплата.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4 lg:w-[500px]">
                {trustItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-2xl border bg-white/70 p-3">
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
