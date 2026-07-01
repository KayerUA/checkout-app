import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";

export default async function AbandonedPage() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    redirect("/admin");
  }

  const abandoned = await prisma.checkoutSession.findMany({
    where: { merchantId: session.merchantId, status: "ABANDONED" },
    orderBy: { abandonedAt: "desc" },
    take: 50,
    include: { lines: true },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Abandoned Checkouts</h1>
      <Card>
        <CardHeader>
          <CardTitle>{abandoned.length} sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {abandoned.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{s.buyerEmail ?? s.buyerPhone ?? "Anonymous"}</p>
                  <p className="text-zinc-500">
                    {(s.totalAmount / 100).toFixed(2)} {s.currency} · {s.lines.length} items
                  </p>
                </div>
                <a
                  href={`/checkout/${s.publicToken}`}
                  className="text-zinc-900 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  View
                </a>
              </div>
            ))}
            {abandoned.length === 0 && (
              <p className="text-zinc-500">No abandoned sessions yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
