"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckoutProgress } from "@/components/checkout/checkout-progress";
import { OrderSummary } from "@/components/checkout/order-summary";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  Search,
  Truck,
  User,
} from "lucide-react";

type CheckoutLine = {
  id: string;
  title: string;
  quantity: number;
  unitPrice: number;
};

type CheckoutData = {
  publicToken: string;
  status: string;
  currency: string;
  subtotal: number;
  shippingAmount: number;
  totalAmount: number;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  buyerFirstName?: string | null;
  buyerLastName?: string | null;
  shippingPayload?: Record<string, string> | null;
  paymentProvider?: string | null;
  customAttributes?: Record<string, string> | null;
  lines: CheckoutLine[];
  theme?: Record<string, string>;
  ab?: Record<string, string> | null;
};

type City = { ref: string; name: string };
type Branch = { ref: string; number: string; shortAddress: string; cityName: string };

function cleanDigits(value: FormDataEntryValue | null) {
  return String(value ?? "").replace(/\D/g, "");
}

function validateCompanyBillingFields(form: FormData) {
  const companyName = String(form.get("fop_name") ?? "").trim();
  const taxId = cleanDigits(form.get("fop_tax_id"));
  const docsEmail = String(form.get("docs_email") ?? "").trim();
  const docsPhone = cleanDigits(form.get("docs_phone") || form.get("phone"));
  const legalAddress = String(form.get("fop_legal_address") ?? "").trim();

  if (companyName.length < 3) return "Вкажіть назву компанії або ПІБ ФОП.";
  if (![8, 10].includes(taxId.length)) return "ЄДРПОУ має містити 8 цифр, ІПН/РНОКПП — 10 цифр.";
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
  children,
}: {
  step: number;
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Крок {step}
            </Badge>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function CheckoutForm({ initial }: { initial: CheckoutData }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedCityRef, setSelectedCityRef] = useState("");
  const initialAttrs = initial.customAttributes ?? {};
  const [buyerType, setBuyerType] = useState(initialAttrs.buyer_type ?? "individual");
  const [paymentPreference, setPaymentPreference] = useState(
    initialAttrs.payment_preference ?? "card"
  );
  const [searchingCities, setSearchingCities] = useState(false);

  const buttonText = data.theme?.buttonText ?? "Оформити замовлення";

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
      setSearchingCities(false);
    }, 300);
    return () => clearTimeout(t);
  }, [cityQuery]);

  useEffect(() => {
    if (!selectedCityRef) return;
    fetch(`/api/public/shipping/nova-poshta/branches?cityRef=${selectedCityRef}`)
      .then((r) => r.json())
      .then(setBranches);
  }, [selectedCityRef]);

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
    const selectedPaymentProvider = paymentPreference === "bank_invoice" ? "BANK_INVOICE" : "LIQPAY";

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
          payment_preference: paymentPreference,
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
    const updated = await saveSession({
      shippingPayload: {
        branchRef: branch.ref,
        branchName: branch.shortAddress,
        cityName: branch.cityName,
      },
    });
    setData(updated);
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
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <CheckoutProgress currentStep={currentStep} />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:gap-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <StepCard step={1} title="Контактні дані" description="Для зв'язку щодо замовлення" icon={User}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">Ім&apos;я</Label>
                <Input id="firstName" name="firstName" defaultValue={data.buyerFirstName ?? ""} placeholder="Олена" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Прізвище</Label>
                <Input id="lastName" name="lastName" defaultValue={data.buyerLastName ?? ""} placeholder="Коваленко" required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="phone">Телефон</Label>
                <Input id="phone" name="phone" type="tel" defaultValue={data.buyerPhone ?? ""} placeholder="+380 XX XXX XX XX" required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={data.buyerEmail ?? ""} placeholder="email@example.com" />
              </div>

              <div className="space-y-3 rounded-lg border p-4 sm:col-span-2">
                <div>
                  <p className="text-sm font-medium">Покупаєте як ФОП або компанія?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Для покупок від ФОП або компанії рекомендуємо оплату за рахунком з підприємницького/юридичного рахунку. Так ми зможемо автоматично підготувати документи для бухгалтерії.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={cn("flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm", buyerType === "individual" && "border-primary bg-muted")}>
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
                  <label className={cn("flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm", buyerType === "fop_company" && "border-primary bg-muted")}>
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
                    ФОП / юридична особа
                  </label>
                </div>

                {buyerType === "fop_company" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="fop_name">Назва компанії / ПІБ ФОП</Label>
                      <Input id="fop_name" name="fop_name" defaultValue={initialAttrs.fop_name ?? ""} minLength={3} required={buyerType === "fop_company"} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fop_tax_id">ЄДРПОУ / ІПН</Label>
                      <Input
                        id="fop_tax_id"
                        name="fop_tax_id"
                        defaultValue={initialAttrs.fop_tax_id ?? ""}
                        inputMode="numeric"
                        pattern="\\d{8}|\\d{10}"
                        title="ЄДРПОУ має містити 8 цифр, ІПН/РНОКПП — 10 цифр"
                        required={buyerType === "fop_company"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="docs_email">Email для документів</Label>
                      <Input id="docs_email" name="docs_email" type="email" defaultValue={initialAttrs.docs_email ?? data.buyerEmail ?? ""} required={buyerType === "fop_company"} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="docs_phone">Телефон</Label>
                      <Input id="docs_phone" name="docs_phone" type="tel" defaultValue={initialAttrs.docs_phone ?? data.buyerPhone ?? ""} required={buyerType === "fop_company"} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="fop_legal_address">Юридична адреса</Label>
                      <Input id="fop_legal_address" name="fop_legal_address" defaultValue={initialAttrs.fop_legal_address ?? ""} minLength={8} required={buyerType === "fop_company"} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="accounting_comment">Коментар для бухгалтерії</Label>
                      <Input id="accounting_comment" name="accounting_comment" defaultValue={initialAttrs.accounting_comment ?? ""} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </StepCard>

          <StepCard step={2} title="Доставка" description="Нова Пошта — відділення або поштомат" icon={Truck}>
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
                      if (e.target.value.length < 2) {
                        setCities([]);
                        setSearchingCities(false);
                      }
                    }}
                    placeholder="Почніть вводити назву міста"
                    autoComplete="off"
                    className="pr-9"
                  />
                </div>
                {searchingCities && <Skeleton className="h-10 w-full" />}
                {cities.length > 0 && (
                  <ScrollArea className="h-40 rounded-md border">
                    <div className="p-1">
                      {cities.map((c) => (
                        <button
                          key={c.ref}
                          type="button"
                          className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setSelectedCityRef(c.ref);
                            setCityQuery(c.name);
                            setCities([]);
                          }}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>

              {branches.length > 0 && (
                <div className="space-y-2">
                  <Label>Відділення</Label>
                  <ScrollArea className="h-48 rounded-md border">
                    <div className="p-1">
                      {branches.map((b) => {
                        const selected = data.shippingPayload?.branchRef === b.ref;
                        return (
                          <button
                            key={b.ref}
                            type="button"
                            className={cn(
                              "flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted",
                              selected && "bg-muted font-medium"
                            )}
                            onClick={() => selectBranch(b)}
                          >
                            <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent" />
                            <span>
                              <span className="font-medium">№{b.number}</span> — {b.shortAddress}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {data.shippingPayload?.branchName && (
                <Alert>
                  <MapPin className="size-4" />
                  <AlertDescription>
                    <span className="font-medium">Обрано: </span>
                    {data.shippingPayload.branchName as string}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </StepCard>

          <StepCard step={3} title="Спосіб оплати" description="Картка або рахунок для ФОП / юридичної особи" icon={CreditCard}>
            <div className="grid gap-3">
              <label className={cn("flex cursor-pointer items-center gap-4 rounded-lg border p-4", paymentPreference === "card" && "border-primary bg-muted/50")}>
                <input
                  type="radio"
                  name="payment_preference_ui"
                  value="card"
                  checked={paymentPreference === "card"}
                  onChange={() => setPaymentPreference("card")}
                />
                <span className="flex size-10 items-center justify-center rounded-md bg-background">
                  <CreditCard className="size-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">LiqPay</span>
                  <span className="block text-xs text-muted-foreground">Visa, Mastercard, Apple Pay</span>
                </span>
              </label>
              {buyerType === "fop_company" && paymentPreference === "card" && (
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    Оплата карткою підходить для швидкої покупки фізичної особи. Якщо вам потрібна оплата саме від ФОП або юридичної особи — оберіть оплату за рахунком.
                  </AlertDescription>
                </Alert>
              )}
              {buyerType === "fop_company" && (
                <label className={cn("flex cursor-pointer items-center gap-4 rounded-lg border p-4", paymentPreference === "bank_invoice" && "border-primary bg-muted/50")}>
                  <input
                    type="radio"
                    name="payment_preference_ui"
                    value="bank_invoice"
                    checked={paymentPreference === "bank_invoice"}
                    onChange={() => setPaymentPreference("bank_invoice")}
                  />
                  <span className="flex size-10 items-center justify-center rounded-md bg-background">
                    <FileText className="size-4" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Оплата за рахунком</span>
                    <span className="block text-xs text-muted-foreground">Рахунок буде надіслано на email для документів</span>
                  </span>
                </label>
              )}
            </div>
          </StepCard>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || !data.shippingPayload?.branchRef}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Обробка…
              </>
            ) : (
              buttonText
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Натискаючи кнопку, ви погоджуєтесь з{" "}
            <a href="https://kayer.ua" className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noreferrer">
              умовами доставки та оплати
            </a>
          </p>
        </form>

        <OrderSummary
          lines={data.lines}
          currency={data.currency}
          subtotal={data.subtotal}
          shippingAmount={data.shippingAmount}
          totalAmount={data.totalAmount}
          shippingLabel={data.shippingPayload?.branchName ? "Нова Пошта" : undefined}
        />
      </div>
    </div>
  );
}
