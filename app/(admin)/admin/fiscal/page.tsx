import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function FiscalPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fiscal (Checkbox)</h1>
      <Card>
        <CardHeader>
          <CardTitle>Checkbox integration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-600">
            Configure cash register license key, fiscal number and cashier PIN via PATCH /api/merchant/fiscal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
