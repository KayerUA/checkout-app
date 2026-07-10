import { formatMoney } from "@/lib/checkout/pricing";
import { buildCheckoutLineTitle } from "@/lib/checkout/line-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Package, Plus } from "lucide-react";

type Line = {
  id: string;
  title: string;
  quantity: number;
  unitPrice: number;
  compareAtPrice?: number | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
};

type Recommendation = {
  productGid: string;
  variantGid: string;
  title: string;
  variantTitle?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  unitPrice: number;
  compareAtPrice?: number | null;
};

type Props = {
  lines: Line[];
  currency: string;
  subtotal: number;
  shippingAmount: number;
  totalAmount: number;
  shippingLabel?: string;
  recommendations?: Recommendation[];
  addingVariantGid?: string | null;
  onAddRecommendation?: (recommendation: Recommendation) => void;
};

export function OrderSummary({
  lines,
  currency,
  subtotal,
  shippingAmount,
  totalAmount,
  shippingLabel,
  recommendations = [],
  addingVariantGid,
  onAddRecommendation,
}: Props) {
  const lineVariantTitles = new Set(lines.map((line) => line.title));
  const visibleRecommendations = recommendations
    .filter((item) => !lineVariantTitles.has(`${item.title} — ${item.variantTitle}`))
    .slice(0, 3);
  const deliveryTerms =
    shippingAmount === 0
      ? "Якщо замовлення відповідає умовам безкоштовної доставки, її оплатить магазин. В іншому разі клієнт оплачує доставку Новій Пошті під час отримання."
      : formatMoney(shippingAmount, currency);

  const itemsBlock = (
    <>
      <ul className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {lines.map((line) => (
          <li key={line.id} className="flex gap-3">
            <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-secondary">
              {line.imageUrl ? (
                // Use a plain image here to avoid remote image domain config churn for Shopify CDN.
                <img
                  src={line.imageUrl}
                  alt={line.imageAlt ?? line.title}
                  className="size-full object-contain"
                  loading="lazy"
                />
              ) : (
                <Package className="size-5 text-muted-foreground" />
              )}
              <span className="absolute right-1 bottom-1 rounded-full bg-background/95 px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
                {line.quantity}×
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm leading-snug">{line.title}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{formatMoney(line.unitPrice, currency)} / шт.</span>
                {line.compareAtPrice && line.compareAtPrice > line.unitPrice ? (
                  <span className="line-through">{formatMoney(line.compareAtPrice, currency)}</span>
                ) : null}
              </div>
            </div>
            <p className="shrink-0 text-sm font-medium">
              {formatMoney(line.unitPrice * line.quantity, currency)}
            </p>
          </li>
        ))}
      </ul>

      {visibleRecommendations.length > 0 && onAddRecommendation ? (
        <div className="space-y-3 rounded-2xl border bg-secondary/40 p-3">
          <div>
            <p className="text-sm font-medium">Додати до замовлення</p>
            <p className="text-xs text-muted-foreground">Корисні позиції до поточної покупки</p>
          </div>
          <div className="space-y-2">
            {visibleRecommendations.map((item) => {
              const loading = addingVariantGid === item.variantGid;
              return (
                <div key={item.variantGid} className="flex gap-2 rounded-xl bg-background p-2 ring-1 ring-border">
                  <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-secondary">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.imageAlt ?? item.title}
                        className="size-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <Package className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-medium leading-snug">
                      {buildCheckoutLineTitle({
                        productTitle: item.title,
                        variantTitle: item.variantTitle,
                      })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatMoney(item.unitPrice, currency)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 px-2"
                    onClick={() => onAddRecommendation(item)}
                    disabled={loading}
                    aria-label={`Додати ${item.title}`}
                  >
                    {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );

  const totalsBlock = (
    <>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>Підсумок</span>
        <span>{formatMoney(subtotal, currency)}</span>
      </div>
      <div className="flex items-start justify-between gap-5 text-sm text-muted-foreground">
        <span className="shrink-0">Доставка</span>
        <span className="text-right leading-5">
          {shippingLabel ? <span className="font-medium text-foreground/75">{shippingLabel}</span> : null}
          {shippingLabel ? <br /> : null}
          {deliveryTerms}
        </span>
      </div>
      <Separator />
      <div className="flex justify-between text-base font-semibold">
        <span>Разом</span>
        <span>{formatMoney(totalAmount, currency)}</span>
      </div>
    </>
  );

  return (
    <>
      <details className="rounded-2xl border bg-card/90 p-4 shadow-[0_18px_45px_rgba(28,20,16,0.07)] ring-1 ring-white/70 backdrop-blur-xl lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-medium">
            <Package className="size-4 text-muted-foreground" />
            Ваше замовлення
            <Badge variant="secondary">{lines.length} поз.</Badge>
          </span>
          <span className="font-semibold">{formatMoney(totalAmount, currency)}</span>
        </summary>
        <div className="mt-4 space-y-4">
          {itemsBlock}
          <div className="space-y-3 border-t pt-4">{totalsBlock}</div>
        </div>
      </details>

      <Card className="hidden max-h-[calc(100vh-3rem)] bg-card/82 shadow-[0_28px_80px_rgba(28,20,16,0.08)] ring-white/70 backdrop-blur-2xl lg:flex">
        <CardHeader className="shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-secondary text-foreground ring-1 ring-black/[0.04]">
              <Package className="size-4" />
            </span>
            <CardTitle>Ваше замовлення</CardTitle>
          </div>
          <Badge variant="secondary" className="rounded-full">{lines.length} поз.</Badge>
        </div>
        <CardDescription>Перевірте склад замовлення перед оплатою</CardDescription>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        {itemsBlock}
      </CardContent>

      <CardFooter className="shrink-0 flex-col items-stretch gap-3 border-t">
        {totalsBlock}
      </CardFooter>
    </Card>
    </>
  );
}
