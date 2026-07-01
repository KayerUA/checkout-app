import { formatMoney } from "@/lib/checkout/pricing";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Package } from "lucide-react";

type Line = {
  id: string;
  title: string;
  quantity: number;
  unitPrice: number;
};

type Props = {
  lines: Line[];
  currency: string;
  subtotal: number;
  shippingAmount: number;
  totalAmount: number;
  shippingLabel?: string;
};

export function OrderSummary({
  lines,
  currency,
  subtotal,
  shippingAmount,
  totalAmount,
  shippingLabel,
}: Props) {
  return (
    <Card className="lg:sticky lg:top-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <CardTitle>Ваше замовлення</CardTitle>
          </div>
          <Badge variant="secondary">{lines.length} поз.</Badge>
        </div>
        <CardDescription>Перевірте склад замовлення перед оплатою</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <ul className="max-h-64 space-y-3 overflow-y-auto pr-1">
          {lines.map((line) => (
            <li key={line.id} className="flex gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
                {line.quantity}×
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm leading-snug">{line.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatMoney(line.unitPrice, currency)} / шт.
                </p>
              </div>
              <p className="shrink-0 text-sm font-medium">
                {formatMoney(line.unitPrice * line.quantity, currency)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3 border-t">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Підсумок</span>
          <span>{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Доставка{shippingLabel ? ` · ${shippingLabel}` : ""}</span>
          <span>{shippingAmount === 0 ? "—" : formatMoney(shippingAmount, currency)}</span>
        </div>
        <Separator />
        <div className="flex justify-between text-base font-semibold">
          <span>Разом</span>
          <span>{formatMoney(totalAmount, currency)}</span>
        </div>
      </CardFooter>
    </Card>
  );
}
