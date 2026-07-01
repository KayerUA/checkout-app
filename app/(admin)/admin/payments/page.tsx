import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentConfigForm } from "@/components/admin/payment-config-form";

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Оплата</h1>
        <p className="text-sm text-muted-foreground">LiqPay — єдиний спосіб оплати для kayer.ua</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>LiqPay</CardTitle>
          <CardDescription>
            Вкажіть ключі з кабінету LiqPay. Callback URL вказується автоматично нижче.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentConfigForm />
        </CardContent>
      </Card>
    </div>
  );
}
