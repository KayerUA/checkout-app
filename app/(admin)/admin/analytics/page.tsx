import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <Card>
        <CardHeader>
          <CardTitle>GA4 & Meta</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-600">
            Server-side purchase events are sent after confirmed payment. Configure IDs via PATCH /api/merchant/analytics.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
