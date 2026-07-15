"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckoutProgress } from "@/components/checkout/checkout-progress";
import { OrderSummary } from "@/components/checkout/order-summary";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/checkout/pricing";
import type { SavingsSummary } from "@/lib/checkout/savings-summary";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  FileText,
  Headphones,
  Loader2,
  MapPin,
  Package,
  Search,
  ShieldCheck,
  Store,
  Truck,
  User,
} from "lucide-react";

type CheckoutLine = {
  id: string;
  title: string;
  quantity: number;
  unitPrice: number;
  compareAtPrice?: number | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
};

type CheckoutRecommendation = {
  productGid: string;
  variantGid: string;
  title: string;
  variantTitle?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  unitPrice: number;
  compareAtPrice?: number | null;
};

type CheckoutData = {
  publicToken: string;
  status: string;
  currency: string;
  subtotal: number;
  shippingAmount: number;
  discountAmount: number;
  totalAmount: number;
  savingsSummary?: SavingsSummary | null;
  appliedDiscountCode?: string | null;
  pricingMode?: string;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  buyerFirstName?: string | null;
  buyerLastName?: string | null;
  shippingPayload?: Record<string, string> | null;
  paymentProvider?: string | null;
  customAttributes?: Record<string, unknown> | null;
  lines: CheckoutLine[];
  recommendations?: CheckoutRecommendation[];
  theme?: Record<string, string>;
  ab?: Record<string, string> | null;
};

type City = { ref: string; name: string };
type Branch = {
  ref: string;
  number: string;
  shortAddress: string;
  cityName: string;
  cityRef?: string;
  postalCode?: string;
  type?: "branch" | "locker" | "courier";
};
type BuyerType = "individual" | "fop_company";
type PaymentPreference = "card" | "bank_invoice";

function cleanDigits(value: FormDataEntryValue | null) {
  return String(value ?? "").replace(/\D/g, "");
}

function validateCompanyBillingFields(form: FormData) {
  const companyName = String(form.get("fop_name") ?? "").trim();
  const taxId = cleanDigits(form.get("fop_tax_id"));
  const docsEmail = String(form.get("docs_email") || form.get("email") || "").trim();
  const docsPhone = cleanDigits(form.get("docs_phone") || form.get("phone"));
  const legalAddress = String(form.get("fop_legal_address") ?? "").trim();

  if (companyName.length < 3) return "Вкажіть назву компанії або ПІБ ФОП.";
  if (![8, 10].includes(taxId.length)) return "ЄДРПОУ має містити 8 цифр, ІПН або РНОКПП — 10 цифр.";
  if (!docsEmail.includes("@")) return "Вкажіть коректний email для документів.";
  if (docsPhone.length < 10) return "Вкажіть коректний телефон для документів.";
  if (legalAddress.length < 8) return "Вкажіть юридичну адресу.";

  return null;
}

function StepCard({
  step,
  title,
  description,
  icon: Icon,
  active,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  icon: React.ElementType;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[1.3rem] bg-white/84 p-3 shadow-[0_12px_34px_rgba(18,18,18,0.055)] ring-1 ring-black/[0.045] backdrop-blur-xl transition-colors sm:rounded-[1.65rem] sm:p-5",
        active && "ring-primary/25"
      )}
    >
      <div className="mb-3 flex items-start gap-3 sm:mb-4">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[1.05rem] bg-zinc-50 text-muted-foreground shadow-sm ring-1 ring-black/5 sm:size-10 sm:rounded-2xl",
            active && "bg-primary text-primary-foreground"
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Крок {step}
            </span>
            {active ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight sm:text-base">{title}</h2>
          {description ? (
            <p className="text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function CheckoutForm({ initial }: { initial: CheckoutData }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [cityListOpen, setCityListOpen] = useState(false);
  const [branchListOpen, setBranchListOpen] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selectingBranchRef, setSelectingBranchRef] = useState<string | null>(null);
  const [selectedCityRef, setSelectedCityRef] = useState(
    (initial.shippingPayload?.cityRef as string | undefined) ?? ""
  );
  const initialAttrs = (initial.customAttributes ?? {}) as Record<string, string>;
  const [buyerType, setBuyerType] = useState<BuyerType>(
    initialAttrs.buyer_type === "fop_company" ? "fop_company" : "individual"
  );
  const [paymentPreference, setPaymentPreference] = useState<PaymentPreference>(
    initialAttrs.buyer_type === "fop_company" ? "bank_invoice" : "card"
  );
  const [searchingCities, setSearchingCities] = useState(false);
  const [addingVariantGid, setAddingVariantGid] = useState<string | null>(null);

  const buttonText = data.theme?.buttonText ?? "Оформити замовлення";
  const loadingText =
    buyerType === "fop_company"
      ? "Створюємо замовлення та генеруємо рахунок..."
      : "Готуємо безпечний перехід до LiqPay...";
  const deliveryTerms =
    "Від 3 000 грн доставку оплачує магазин. До 3 000 грн ви оплачуєте доставку Новій Пошті під час отримання; у суму замовлення доставка не додається.";
  const firstLine = data.lines[0];
  const extraLinesCount = Math.max(data.lines.length - 1, 0);
  const contactFirstNameDefault = data.buyerFirstName ?? initialAttrs.customer_first_name ?? "";
  const contactLastNameDefault = data.buyerLastName ?? initialAttrs.customer_last_name ?? "";
  const contactEmailDefault = data.buyerEmail ?? initialAttrs.customer_email ?? initialAttrs.docs_email ?? "";
  const contactPhoneDefault = data.buyerPhone ?? initialAttrs.customer_phone ?? initialAttrs.docs_phone ?? "";

  useEffect(() => {
    const ab = data.ab;
    if (!ab?.experimentId || !ab.visitorId || !ab.variant) return;
    fetch("/api/checkout-ab/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experimentId: ab.experimentId,
        visitorId: ab.visitorId,
        variant: ab.variant,
        eventName: "checkout_loaded",
        checkoutSessionId: data.publicToken,
        payload: { page: "checkout_form" },
      }),
    }).catch(() => {});
  }, [data.ab, data.publicToken]);

  const currentStep: 1 | 2 | 3 =
    !data.buyerPhone ? 1 : !data.shippingPayload?.branchRef ? 2 : 3;

  const saveSession = useCallback(async (patch: Record<string, unknown>) => {
    const res = await fetch(`/api/public/checkout-sessions/${data.publicToken}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("Не вдалося зберегти дані");
    return res.json();
  }, [data.publicToken]);

  useEffect(() => {
    if (cityQuery.length < 2) {
      return;
    }
    const t = setTimeout(async () => {
      setSearchingCities(true);
      const res = await fetch(
        `/api/public/shipping/nova-poshta/cities?q=${encodeURIComponent(cityQuery)}`
      );
      setCities(await res.json());
      setCityListOpen(true);
      setSearchingCities(false);
    }, 300);
    return () => clearTimeout(t);
  }, [cityQuery]);

  useEffect(() => {
    if (!selectedCityRef) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoadingBranches(true);
      const params = new URLSearchParams({ cityRef: selectedCityRef });
      if (branchQuery.trim()) params.set("q", branchQuery.trim());
      fetch(`/api/public/shipping/nova-poshta/branches?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Не вдалося знайти відділення");
          return response.json() as Promise<Branch[]>;
        })
        .then(setBranches)
        .catch((fetchError: unknown) => {
          if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
          setBranches([]);
        })
        .finally(() => setLoadingBranches(false));
    }, branchQuery ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [branchQuery, selectedCityRef]);

  useEffect(() => {
    if (data.status === "PAYMENT_PENDING") {
      const interval = setInterval(async () => {
        const res = await fetch(`/api/public/checkout-sessions/${data.publicToken}/status`);
        const status = await res.json();
        if (status.status === "PAID" || status.status === "COMPLETED") {
          window.location.href = `/checkout/${data.publicToken}/thank-you`;
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [data.publicToken, data.status]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const docsEmail = String(form.get("docs_email") || form.get("email") || "");
    const effectivePaymentPreference =
      buyerType === "fop_company" ? "bank_invoice" : paymentPreference;
    const selectedPaymentProvider =
      effectivePaymentPreference === "bank_invoice" ? "BANK_INVOICE" : "LIQPAY";

    try {
      if (buyerType === "fop_company") {
        const validationError = validateCompanyBillingFields(form);
        if (validationError) {
          setError(validationError);
          setLoading(false);
          return;
        }
      }

      await saveSession({
        buyerEmail: form.get("email"),
        buyerPhone: form.get("phone"),
        buyerFirstName: form.get("firstName"),
        buyerLastName: form.get("lastName"),
        shippingProvider: "nova_poshta",
        shippingMethodCode: "nova_poshta_branch",
        paymentProvider: selectedPaymentProvider,
        customAttributes: {
          buyer_type: buyerType,
          payment_preference: effectivePaymentPreference,
          fop_name: form.get("fop_name"),
          fop_tax_id: form.get("fop_tax_id"),
          fop_legal_address: form.get("fop_legal_address"),
          docs_email: docsEmail,
          docs_phone: form.get("docs_phone") || form.get("phone"),
          accounting_comment: form.get("accounting_comment"),
        },
        status: "READY",
      });

      await fetch(`/api/public/checkout-sessions/${data.publicToken}/reprice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const payRes = await fetch(
        `/api/public/checkout-sessions/${data.publicToken}/payments/init`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: selectedPaymentProvider }),
        }
      );
      const payData = await payRes.json();
      if (!payRes.ok) throw new Error(payData.error ?? "Помилка оплати");

      if (payData.redirectUrl) {
        window.location.href = payData.redirectUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }

  async function selectBranch(branch: Branch) {
    if (!/^\d{5}$/.test(branch.postalCode ?? "")) {
      setError(
        "Нова Пошта не повернула поштовий індекс цього відділення. Оновіть пошук або оберіть інше відділення."
      );
      return;
    }
    setSelectingBranchRef(branch.ref);
    setError(null);
    setBranchListOpen(false);
    setError(null);
    try {
      const updated = await saveSession({
        shippingPayload: {
          cityRef: branch.cityRef ?? selectedCityRef,
          cityName: branch.cityName,
          branchRef: branch.ref,
          branchName: branch.shortAddress,
          branchNumber: branch.number,
          branchType: branch.type ?? "branch",
          postalCode: branch.postalCode,
        },
      });
      setData(updated);
      setBranchListOpen(false);
      if (data.ab?.experimentId && data.ab.visitorId && data.ab.variant) {
        fetch("/api/checkout-ab/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            experimentId: data.ab.experimentId,
            visitorId: data.ab.visitorId,
            variant: data.ab.variant,
            eventName: "shipping_selected",
            checkoutSessionId: data.publicToken,
            payload: { branchRef: branch.ref },
          }),
        }).catch(() => {});
      }
      await fetch(`/api/public/checkout-sessions/${data.publicToken}/reprice`, { method: "POST" });
      const refresh = await fetch(`/api/public/checkout-sessions/${data.publicToken}`);
      setData(await refresh.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося обрати відділення.");
    } finally {
      setSelectingBranchRef(null);
    }
  }

  async function addRecommendation(recommendation: CheckoutRecommendation) {
    setAddingVariantGid(recommendation.variantGid);
    setError(null);
    try {
      const res = await fetch(`/api/public/checkout-sessions/${data.publicToken}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantGid: recommendation.variantGid, quantity: 1 }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error ?? "Не вдалося додати товар");
      setData(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося додати товар");
    } finally {
      setAddingVariantGid(null);
    }
  }

  const handleSessionUpdate = useCallback((session: Record<string, unknown>) => {
    setData((current) => ({ ...current, ...(session as Partial<CheckoutData>) }));
  }, []);

  const submitHint = data.shippingPayload?.branchRef
    ? buyerType === "fop_company"
      ? "Після підтвердження підготуємо рахунок."
      : "Після підтвердження відкриємо захищену оплату."
    : "Оберіть відділення або поштомат, щоб продовжити.";

  const submitBar = (formId?: string, compact = false) => (
    <>
      <div className={cn("flex items-center justify-between gap-3 text-xs", compact ? "mb-2" : "mb-2.5 sm:mb-3")}>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" />
          <span className="truncate">Безпечна оплата</span>
        </span>
        <span className="shrink-0 text-sm font-semibold sm:text-xs">
          {formatMoney(data.totalAmount, data.currency)}
        </span>
      </div>
      <button
        type="submit"
        form={formId}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-full bg-black text-[15px] font-semibold text-white shadow-[0_16px_28px_rgba(0,0,0,0.2)] transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 sm:h-14 sm:text-base",
          compact ? "h-11" : "h-13"
        )}
        disabled={loading || !data.shippingPayload?.branchRef}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {loadingText}
          </>
        ) : (
          buttonText
        )}
      </button>
      {!compact ? (
        <p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground sm:mt-3 sm:text-xs">
          {submitHint}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="relative mx-auto max-w-[430px] px-2 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:max-w-6xl sm:px-6 sm:pb-12">
      <div className="pointer-events-none absolute inset-x-2 top-0 h-[460px] rounded-[2.75rem] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.98),rgba(238,226,218,0.82)_54%,rgba(248,247,245,0.24)_100%)] blur-0 lg:hidden" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,620px)_380px] lg:justify-center lg:gap-8">
        <form
          id="kayer-checkout-form"
          onSubmit={handleSubmit}
          className="order-1 overflow-hidden rounded-[2.15rem] bg-white/62 p-2 pt-3 shadow-[0_28px_90px_rgba(18,18,18,0.16)] ring-1 ring-white/80 backdrop-blur-2xl sm:rounded-[2.5rem] sm:p-5 lg:order-1"
          aria-busy={loading}
        >
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-zinc-300/80 sm:mb-4 sm:h-1.5 sm:w-10" />
          <div className="mb-4 text-center sm:mb-5">
            <p className="text-[17px] font-semibold tracking-tight sm:text-lg">Підтвердіть замовлення</p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground sm:mt-1 sm:text-xs">Офіційний checkout KAYER</p>
          </div>

          {firstLine ? (
            <div className="mb-4 flex items-center gap-3 px-1 sm:mb-5 sm:gap-4 lg:hidden">
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[1.35rem] bg-white shadow-sm ring-1 ring-black/[0.045] sm:size-20 sm:rounded-[1.5rem]">
                {firstLine.imageUrl ? (
                  // Use a plain image here to avoid remote image domain config churn for Shopify CDN.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={firstLine.imageUrl}
                    alt={firstLine.imageAlt ?? firstLine.title}
                    className="size-full object-contain"
                  />
                ) : (
                  <Package className="size-7 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="line-clamp-2 text-[15px] font-semibold leading-5 sm:text-base sm:leading-6">{firstLine.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">
                  {firstLine.quantity} шт.
                  {extraLinesCount ? ` + ще ${extraLinesCount}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-[15px] font-semibold sm:text-base">
                {formatMoney(firstLine.unitPrice * firstLine.quantity, data.currency)}
              </p>
            </div>
          ) : null}

          <details className="mb-4 rounded-[1.25rem] bg-white/92 px-4 py-3 text-left shadow-sm ring-1 ring-black/[0.045] sm:mb-5 sm:rounded-[1.5rem] lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
              <span>
                <span className="block text-[15px] font-semibold sm:text-base">До сплати</span>
                <span className="text-xs text-muted-foreground">Натисніть, щоб побачити деталі</span>
              </span>
              <span className="text-lg font-semibold">{formatMoney(data.totalAmount, data.currency)}</span>
            </summary>
            <div className="mt-4 space-y-3 border-t pt-4">
              {data.lines.map((line) => (
                <div key={line.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {line.quantity}× {line.title}
                  </span>
                  <span className="shrink-0 font-medium">
                    {formatMoney(line.unitPrice * line.quantity, data.currency)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Доставка</span>
                <span className="max-w-[70%] text-right leading-5">
                  {data.shippingAmount === 0 ? deliveryTerms : formatMoney(data.shippingAmount, data.currency)}
                </span>
              </div>
            </div>
          </details>

          <div className="hidden sm:block">
            <CheckoutProgress currentStep={currentStep} />
          </div>

          <div className="space-y-3 pb-2 sm:space-y-4">
          <StepCard step={1} title="Контактні дані" description="Для зв'язку щодо замовлення та підтвердження доставки" icon={User} active={currentStep === 1}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">Ім&apos;я</Label>
                <Input id="firstName" name="firstName" defaultValue={contactFirstNameDefault} placeholder="Олена" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Прізвище</Label>
                <Input id="lastName" name="lastName" defaultValue={contactLastNameDefault} placeholder="Коваленко" required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="phone">Телефон</Label>
                <Input id="phone" name="phone" type="tel" defaultValue={contactPhoneDefault} placeholder="+380 XX XXX XX XX" required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={contactEmailDefault} placeholder="email@example.com" required={buyerType === "fop_company"} />
              </div>

              <div className="space-y-3 rounded-[1.2rem] border bg-secondary/35 p-3 sm:col-span-2 sm:rounded-2xl sm:p-4">
                <div>
                  <p className="text-sm font-medium">Потрібен рахунок для ФОП або компанії?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Оберіть цей варіант, якщо потрібен рахунок і документи для бухгалтерії. Оплата буде доступна за рахунком з підприємницького або корпоративного рахунку.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border bg-background p-3 text-sm transition-colors", buyerType === "individual" && "border-primary bg-secondary")}>
                    <input
                      type="radio"
                      name="buyer_type_ui"
                      value="individual"
                      checked={buyerType === "individual"}
                      onChange={() => {
                        setBuyerType("individual");
                        setPaymentPreference("card");
                      }}
                    />
                    Фізична особа
                  </label>
                  <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border bg-background p-3 text-sm transition-colors", buyerType === "fop_company" && "border-primary bg-secondary")}>
                    <input
                      type="radio"
                      name="buyer_type_ui"
                      value="fop_company"
                      checked={buyerType === "fop_company"}
                      onChange={() => {
                        setBuyerType("fop_company");
                        setPaymentPreference("bank_invoice");
                      }}
                    />
                    ФОП або компанія
                  </label>
                </div>

                {buyerType === "fop_company" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="fop_name">Назва компанії або ПІБ ФОП</Label>
                      <Input id="fop_name" name="fop_name" defaultValue={initialAttrs.fop_name ?? ""} minLength={3} required={buyerType === "fop_company"} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fop_tax_id">ЄДРПОУ або ІПН</Label>
                      <Input
                        id="fop_tax_id"
                        name="fop_tax_id"
                        defaultValue={initialAttrs.fop_tax_id ?? ""}
                        inputMode="numeric"
                        pattern="(?:[0-9]{8}|[0-9]{10})"
                        title="ЄДРПОУ має містити 8 цифр, ІПН або РНОКПП — 10 цифр"
                        required={buyerType === "fop_company"}
                      />
                    </div>
                    <p className="rounded-2xl bg-white/70 px-3 py-2 text-xs leading-5 text-muted-foreground ring-1 ring-black/[0.04] sm:col-span-2">
                      Рахунок і документи надішлемо на email з контактних даних. Телефон також використаємо з блоку контактів вище.
                    </p>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="fop_legal_address">Юридична адреса</Label>
                      <Input id="fop_legal_address" name="fop_legal_address" defaultValue={initialAttrs.fop_legal_address ?? ""} minLength={8} required={buyerType === "fop_company"} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="accounting_comment">Коментар для бухгалтерії</Label>
                      <Textarea id="accounting_comment" name="accounting_comment" defaultValue={initialAttrs.accounting_comment ?? ""} placeholder="Наприклад: потрібен рахунок для оплати сьогодні" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </StepCard>

          <StepCard step={2} title="Доставка" description={deliveryTerms} icon={Truck} active={currentStep === 2}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="city">Місто</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="city"
                    value={cityQuery}
                    onChange={(e) => {
                      setCityQuery(e.target.value);
                      setCityListOpen(e.target.value.length >= 2);
                      if (e.target.value.length < 2) {
                        setCities([]);
                        setSearchingCities(false);
                      }
                    }}
                    onFocus={() => {
                      if (cities.length > 0) setCityListOpen(true);
                    }}
                    placeholder="Почніть вводити назву міста"
                    autoComplete="off"
                    className="h-10 pr-9"
                  />
                </div>
                {searchingCities && <Skeleton className="h-10 w-full" />}
                {cityListOpen && cities.length > 0 && (
                  <div className="h-40 overflow-y-auto rounded-xl border bg-background">
                    <div className="p-1">
                      {cities.map((c) => (
                        <button
                          key={c.ref}
                          type="button"
                          className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary"
                          onClick={() => {
                            setSelectedCityRef(c.ref);
                            setCityQuery(c.name);
                            setCities([]);
                            setBranchQuery("");
                            setCityListOpen(false);
                            setBranchListOpen(true);
                            setLoadingBranches(true);
                            void saveSession({
                              shippingPayload: {
                                cityRef: c.ref,
                                cityName: c.name,
                              },
                            }).then(setData);
                          }}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {data.shippingPayload?.cityName && (
                <div className="flex items-center justify-between gap-3 rounded-xl border bg-secondary/35 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground">Місто: </span>
                    <span className="font-medium">{data.shippingPayload.cityName as string}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold underline underline-offset-4"
                    onClick={() => {
                      setCityQuery("");
                      setCities([]);
                      setBranches([]);
                      setBranchQuery("");
                      setSelectedCityRef("");
                      setBranchListOpen(false);
                      void saveSession({ shippingPayload: {} }).then(setData);
                    }}
                  >
                    Змінити
                  </button>
                </div>
              )}

              {selectedCityRef && !data.shippingPayload?.branchRef && !branchListOpen && (
                <button
                  type="button"
                  className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => setBranchListOpen(true)}
                >
                  Обрати відділення або поштомат
                </button>
              )}

              {loadingBranches && selectedCityRef && <Skeleton className="h-14 w-full rounded-xl" />}

              {branchListOpen && selectedCityRef && !data.shippingPayload?.branchRef && (
                <div className="space-y-2">
                  <Label htmlFor="branch">Відділення або поштомат</Label>
                  <Input
                    id="branch"
                    value={branchQuery}
                    onChange={(event) => setBranchQuery(event.target.value)}
                    placeholder="Введіть номер або адресу"
                    autoComplete="off"
                    className="h-10"
                  />
                  {branches.length > 0 ? (
                    <div className="h-48 overflow-y-auto rounded-xl border bg-background">
                      <div className="p-1">
                      {branches.map((b) => {
                        const selected = data.shippingPayload?.branchRef === b.ref;
                        return (
                          <button
                            key={b.ref}
                            type="button"
                            className={cn(
                              "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary",
                              selected && "bg-secondary font-medium"
                            )}
                            onClick={() => selectBranch(b)}
                            disabled={selectingBranchRef === b.ref}
                          >
                            {selectingBranchRef === b.ref ? (
                              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent" />
                            ) : (
                              <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent" />
                            )}
                            <span>
                              <span className="font-medium">№{b.number}</span> — {b.shortAddress}
                            </span>
                          </button>
                        );
                      })}
                      </div>
                    </div>
                  ) : !loadingBranches ? (
                    <p className="text-sm text-muted-foreground">
                      Відділення не знайдено. Спробуйте номер або частину адреси.
                    </p>
                  ) : null}
                </div>
              )}

              {data.shippingPayload?.branchName && (
                <div className="rounded-[1.15rem] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Відділення обрано</p>
                      <p className="mt-1 leading-5">{data.shippingPayload.branchName as string}</p>
                      <button
                        type="button"
                        className="mt-2 text-xs font-semibold underline underline-offset-4"
                        onClick={() => setBranchListOpen(true)}
                      >
                        Змінити відділення
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </StepCard>

          <StepCard step={3} title="Спосіб оплати" description="Карткою для фізичних осіб або за рахунком для ФОП чи компанії." icon={CreditCard} active={currentStep === 3}>
            <div className="grid gap-3">
              {buyerType === "individual" ? (
                <label className={cn("flex cursor-pointer items-center gap-4 rounded-2xl border bg-background p-4 transition-colors", paymentPreference === "card" && "border-primary bg-secondary/70")}>
                  <input
                    type="radio"
                    name="payment_preference_ui"
                    value="card"
                    checked={paymentPreference === "card"}
                    onChange={() => setPaymentPreference("card")}
                  />
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <CreditCard className="size-4" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Безпечна оплата LiqPay</span>
                    <span className="block text-xs leading-5 text-muted-foreground">
                      Visa, Mastercard, Apple Pay. Після підтвердження відкриємо захищену сторінку LiqPay.
                    </span>
                  </span>
                  <ShieldCheck className="hidden size-4 text-emerald-600 sm:block" />
                </label>
              ) : (
                <label className={cn("flex cursor-pointer items-center gap-4 rounded-2xl border bg-background p-4 transition-colors", paymentPreference === "bank_invoice" && "border-primary bg-secondary/70")}>
                  <input
                    type="radio"
                    name="payment_preference_ui"
                    value="bank_invoice"
                    checked={paymentPreference === "bank_invoice"}
                    onChange={() => setPaymentPreference("bank_invoice")}
                    readOnly
                  />
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <FileText className="size-4" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Оплата за рахунком</span>
                    <span className="block text-xs leading-5 text-muted-foreground">Рахунок створимо після підтвердження. Його можна буде завантажити на наступній сторінці.</span>
                  </span>
                </label>
              )}
              {buyerType === "fop_company" && (
                <Alert>
                  <FileText className="size-4" />
                  <AlertDescription>
                    Після підтвердження зачекайте кілька секунд: ми підготуємо рахунок
                    і відкриємо сторінку, де його можна буде завантажити.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </StepCard>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="sticky bottom-2 z-20 hidden rounded-[1.45rem] bg-white/90 p-3 shadow-[0_-10px_35px_rgba(18,18,18,0.12)] ring-1 ring-black/[0.05] backdrop-blur-xl sm:bottom-4 sm:block sm:rounded-[1.65rem] sm:p-4 lg:static lg:shadow-sm">
            <div className="mb-3 hidden gap-2 text-xs text-muted-foreground sm:grid sm:grid-cols-3">
              <span className="inline-flex items-center gap-2"><Store className="size-3.5" /> Офіційний KAYER</span>
              <span className="inline-flex items-center gap-2"><ShieldCheck className="size-3.5" /> Захищена оплата</span>
              <span className="inline-flex items-center gap-2"><Headphones className="size-3.5" /> Підтримка після замовлення</span>
            </div>
            {submitBar()}
            <p className="mt-3 hidden text-center text-xs text-muted-foreground sm:block">
              Натискаючи кнопку, ви погоджуєтесь з{" "}
              <a href="https://kayer.ua" className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noreferrer">
                умовами доставки та оплати
              </a>
            </p>
          </div>
          </div>
        </form>

        <div
          className="fixed inset-x-0 bottom-0 z-50 border-t border-black/[0.06] bg-white/96 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-[0_-12px_40px_rgba(18,18,18,0.14)] backdrop-blur-xl sm:hidden"
          aria-label="Підтвердження замовлення"
        >
          {submitBar("kayer-checkout-form", true)}
        </div>

        <div className="order-first space-y-3 self-start lg:order-2 lg:sticky lg:top-6 lg:space-y-0 lg:pb-2">
          <OrderSummary
            lines={data.lines}
            currency={data.currency}
            subtotal={data.subtotal}
            shippingAmount={data.shippingAmount}
            totalAmount={data.totalAmount}
            savingsSummary={data.savingsSummary}
            shippingLabel={data.shippingPayload?.branchName ? "Нова Пошта" : undefined}
            recommendations={data.recommendations}
            addingVariantGid={addingVariantGid}
            onAddRecommendation={addRecommendation}
            publicToken={data.publicToken}
            pricingMode={data.pricingMode}
            appliedDiscountCode={data.appliedDiscountCode}
            onSessionUpdate={handleSessionUpdate}
          />
        </div>
      </div>
    </div>
  );
}
