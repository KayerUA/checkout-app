import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Receipt } from "lucide-react";

export default function FiscalPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Fiscal"
        description="Checkbox fiscalization status and configuration surface."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Checkbox integration</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Fiscal settings API is ready"
            description="Configure cash register license key, fiscal number and cashier PIN via PATCH /api/merchant/fiscal."
            icon={<Receipt className="size-4" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
