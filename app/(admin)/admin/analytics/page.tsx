import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { BarChart3 } from "lucide-react";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Conversion, paid orders and server-side purchase events."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>GA4 & Meta</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Analytics events are server-side"
            description="Server-side purchase events are sent after confirmed payment. Configure IDs via PATCH /api/merchant/analytics."
            icon={<BarChart3 className="size-4" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
