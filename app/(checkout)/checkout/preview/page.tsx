import { CheckoutForm } from "@/components/checkout/checkout-form";
import { BRAND, CheckoutHeader } from "@/components/checkout/checkout-header";
import { CheckoutFooter } from "@/components/checkout/checkout-footer";

export const metadata = {
  title: "Превʼю checkout — KAYER",
};

const DEMO_DATA = {
  publicToken: "preview-demo",
  status: "DRAFT",
  currency: "UAH",
  subtotal: 189000,
  shippingAmount: 0,
  discountAmount: 0,
  totalAmount: 189000,
  appliedDiscountCode: null,
  pricingMode: "shopify_cart",
  buyerEmail: "",
  buyerPhone: "",
  buyerFirstName: "",
  buyerLastName: "",
  shippingPayload: null,
  paymentProvider: "LIQPAY",
  lines: [
    {
      id: "demo-1",
      title: "Гель-лак KAYER Premium — Rose Nude 15 мл",
      quantity: 2,
      unitPrice: 45000,
    },
    {
      id: "demo-2",
      title: "База для гель-лаку Rubber Base — Clear 10 мл",
      quantity: 1,
      unitPrice: 52000,
    },
    {
      id: "demo-3",
      title: "Пилка для нігтів 180/240 — професійна",
      quantity: 3,
      unitPrice: 14000,
    },
  ],
  theme: {
    logoUrl: "",
    buttonText: "Оформити замовлення",
  },
};

export default function CheckoutPreviewPage() {
  return (
    <>
      <CheckoutHeader />
      <main className="flex-1 py-3 sm:py-12">
        <div className="mx-auto mb-8 hidden max-w-6xl px-4 text-center sm:block sm:px-6">
          <p className="text-xs font-medium uppercase tracking-widest text-accent">
            {BRAND.tagline}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Оформлення замовлення
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Демо-перегляд інтерфейсу (без реальної оплати)
          </p>
        </div>
        <CheckoutForm initial={DEMO_DATA} />
      </main>
      <CheckoutFooter />
    </>
  );
}
