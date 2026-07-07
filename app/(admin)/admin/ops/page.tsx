import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function OpsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations"
        description="Manual reconcile and maintenance jobs for checkout operations."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Reconcile Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Trigger background reconcile jobs via internal API:</p>
          <pre className="overflow-x-auto rounded-2xl bg-zinc-950 p-4 text-xs text-zinc-100">
{`curl -X POST http://localhost:3000/api/internal/jobs \\
  -H "Content-Type: application/json" \\
  -H "x-internal-secret: $INTERNAL_JOBS_SECRET" \\
  -d '{"job":"mark-abandoned"}'

# Available jobs:
# mark-abandoned, reconcile-orders, reconcile-payments,
# reconcile-fiscal, sync-nova-poshta`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
