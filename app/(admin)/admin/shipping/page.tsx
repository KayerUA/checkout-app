import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShippingConfigForm } from "@/components/admin/shipping-config-form";

export default function ShippingPage() {
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
          <ShippingConfigForm />
        </CardContent>
      </Card>
    </div>
  );
}
