import { redirect } from "next/navigation";
import { BankConfigForm } from "@/components/admin/bank-config-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getPrivatBankConfigForMerchant } from "@/lib/bank/config";
import { requireMerchantSession } from "@/lib/session";

export default async function BankSettingsPage() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    redirect("/admin?next=/admin/bank");
  }

  const config = await getPrivatBankConfigForMerchant(session.merchantId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank"
        description="Privat24 Business Autoclient для автоматичного match оплат за рахунком."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Privat24 Business</CardTitle>
          <CardDescription>
            Доступ потрібен тільки до сервісу отримання балансів і транзакцій за рахунками.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BankConfigForm
            initial={{
              isEnabled: config.isEnabled,
              apiUrl: config.apiUrl ?? "https://acp.privatbank.ua/api/statements/transactions",
              clientId: config.clientId ?? "",
              iban: config.iban ?? "",
              hasToken: Boolean(config.token),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
