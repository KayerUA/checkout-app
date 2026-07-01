import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OpsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Operations</h1>
      <Card>
        <CardHeader>
          <CardTitle>Reconcile Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-600">
          <p>Trigger background reconcile jobs via internal API:</p>
          <pre className="rounded bg-zinc-900 p-4 text-xs text-zinc-100 overflow-x-auto">
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
