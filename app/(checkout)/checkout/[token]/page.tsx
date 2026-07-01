import { notFound } from "next/navigation";
import { getCheckoutSessionByToken, serializePublicSession } from "@/lib/checkout/session-service";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { BRAND, CheckoutHeader } from "@/components/checkout/checkout-header";
import { CheckoutFooter } from "@/components/checkout/checkout-footer";

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

  return (
    <>
      <CheckoutHeader logoUrl={data.theme?.logoUrl} />
      <main className="flex-1 py-8 sm:py-12">
        <div className="mx-auto mb-8 max-w-6xl px-4 text-center sm:px-6">
          <p className="text-xs font-medium uppercase tracking-widest text-accent">
            {BRAND.tagline}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Оформлення замовлення
          </h1>
        </div>
        <CheckoutForm initial={data as Parameters<typeof CheckoutForm>[0]["initial"]} />
      </main>
      <CheckoutFooter />
    </>
  );
}
