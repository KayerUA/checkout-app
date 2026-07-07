import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/checkout/pricing";
import { ShoppingCart } from "lucide-react";

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
      <PageHeader
        title="Abandoned"
        description="Checkout sessions that stopped before payment. Use the link to inspect the customer-facing checkout state."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>{abandoned.length} sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {abandoned.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abandoned.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">{session.buyerEmail ?? session.buyerPhone ?? "Anonymous"}</TableCell>
                    <TableCell>{formatMoney(session.totalAmount, session.currency)}</TableCell>
                    <TableCell>{session.lines.length}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {(session.abandonedAt ?? session.updatedAt).toISOString().slice(0, 16)}
                    </TableCell>
                    <TableCell><StatusBadge status={session.status} /></TableCell>
                    <TableCell className="text-right">
                      <a href={`/checkout/${session.publicToken}`} className="font-medium underline underline-offset-4" target="_blank" rel="noreferrer">
                        View checkout
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="No abandoned sessions" description="Recovery opportunities will be listed here after checkout inactivity is marked." icon={<ShoppingCart className="size-4" />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
