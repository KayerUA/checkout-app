import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2 } from "lucide-react";
import { getDiloshopOrderMappings } from "@/lib/telegram/diloshop-client";

export default async function B2BOrdersPage() {
  try {
    await requireMerchantSession();
  } catch {
    redirect("/admin");
  }

  const orders = await prisma.b2BOrder.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const documents = await prisma.b2BDocument.findMany({
    where: { shopifyOrderId: { in: orders.map((order) => order.shopifyOrderId) } },
  });
  const payments = await prisma.bankPayment.findMany({
    where: { matchedShopifyOrderId: { in: orders.map((order) => order.shopifyOrderId) } },
    orderBy: { transactionDate: "desc" },
  });
  const diloshop = await getDiloshopOrderMappings(
    orders.map((order) => order.shopifyOrderId)
  ).catch(() => null);

  const docsByOrder = new Map<string, typeof documents>();
  documents.forEach((doc) => {
    docsByOrder.set(doc.shopifyOrderId, [...(docsByOrder.get(doc.shopifyOrderId) ?? []), doc]);
  });
  const paymentByOrder = new Map<string, (typeof payments)[number]>();
  payments.forEach((payment) => {
    if (
      payment.matchedShopifyOrderId &&
      !paymentByOrder.has(payment.matchedShopifyOrderId)
    ) {
      paymentByOrder.set(payment.matchedShopifyOrderId, payment);
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="B2B / ФОП Orders"
        description="Рахунки, банківська звірка, invoice email через Shopify та бухгалтерські документи."
      />

      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Останні B2B orders</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length > 0 ? (
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>ФОП / юридична особа</TableHead>
                  <TableHead>Tax ID</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Dilovod</TableHead>
                  <TableHead>Docs</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const docs = docsByOrder.get(order.shopifyOrderId) ?? [];
                  const invoice = docs.find((doc) => doc.type === "invoice");
                  const delivery = docs.find((doc) => doc.type === "delivery_note");
                  const payment = paymentByOrder.get(order.shopifyOrderId);
                  const mapping = diloshop?.mappings?.[order.shopifyOrderId];
                  const dilovodId =
                    String(
                      mapping?.sale_order_id ??
                        mapping?.dilovod_sale_order_id ??
                        ""
                    ).trim() || null;
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.shopifyOrderName ?? order.shopifyOrderId}</TableCell>
                      <TableCell>{order.fopName}</TableCell>
                      <TableCell>{order.fopTaxId}</TableCell>
                      <TableCell>{order.docsPhone ?? "—"}</TableCell>
                      <TableCell>{String(order.orderTotalAmount ?? "")} {order.orderCurrency}</TableCell>
                      <TableCell><StatusBadge status={order.status} /></TableCell>
                      <TableCell>
                        {invoice?.pdfUrl ? (
                          <a className="underline" href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                            {invoice.number}
                          </a>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={order.paymentStatus || payment?.status} />
                            <span>{order.paymentPreference ?? "—"}</span>
                          </div>
                          <div>
                            {String(order.paidAmount)} /{" "}
                            {String(order.expectedAmount ?? order.orderTotalAmount ?? "")}{" "}
                            {order.orderCurrency ?? "UAH"}
                          </div>
                          <div className="font-mono text-muted-foreground">
                            {payment?.transactionId ?? "reference —"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {dilovodId ?? "—"}
                      </TableCell>
                      <TableCell>{delivery?.pdfUrl ? <a className="underline" href={delivery.pdfUrl} target="_blank" rel="noreferrer">download</a> : "—"}</TableCell>
                      <TableCell>
                        <form action={`/api/admin/b2b-orders/${order.shopifyOrderId}`} method="post" className="flex flex-wrap gap-2">
                          <Button name="action" value="confirm_payment" size="sm" variant="outline">Confirm</Button>
                          <Button name="action" value="needs_review" size="sm" variant="outline">Review</Button>
                          <Button name="action" value="regenerate_invoice" size="sm" variant="outline">Regenerate</Button>
                          <Button name="action" value="resend_invoice" size="sm" variant="outline">Resend</Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="No B2B orders yet" description="ФОП / юридична особа orders will appear here after invoice checkout." icon={<Building2 className="size-4" />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
