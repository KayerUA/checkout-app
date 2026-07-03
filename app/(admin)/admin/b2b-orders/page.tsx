import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  });

  const docsByOrder = new Map<string, typeof documents>();
  documents.forEach((doc) => {
    docsByOrder.set(doc.shopifyOrderId, [...(docsByOrder.get(doc.shopifyOrderId) ?? []), doc]);
  });
  const paymentByOrder = new Map(payments.map((payment) => [payment.matchedShopifyOrderId, payment]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">B2B/ФОП orders</h1>
        <p className="text-sm text-zinc-500">Рахунки, банківська звірка та бухгалтерські документи.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Останні B2B orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2">Order</th>
                  <th>ФОП / юридична особа</th>
                  <th>Tax ID</th>
                  <th>Phone</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Invoice</th>
                  <th>Payment</th>
                  <th>Docs</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const docs = docsByOrder.get(order.shopifyOrderId) ?? [];
                  const invoice = docs.find((doc) => doc.type === "invoice");
                  const delivery = docs.find((doc) => doc.type === "delivery_note");
                  const payment = paymentByOrder.get(order.shopifyOrderId);
                  return (
                    <tr key={order.id} className="border-b align-top">
                      <td className="py-3 font-medium">{order.shopifyOrderName ?? order.shopifyOrderId}</td>
                      <td>{order.fopName}</td>
                      <td>{order.fopTaxId}</td>
                      <td>{order.docsPhone ?? "—"}</td>
                      <td>{String(order.orderTotalAmount ?? "")} {order.orderCurrency}</td>
                      <td><Badge variant="outline">{order.status}</Badge></td>
                      <td>
                        {invoice?.pdfUrl ? (
                          <a className="underline" href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                            {invoice.number}
                          </a>
                        ) : "—"}
                      </td>
                      <td>{payment?.status ?? "—"}</td>
                      <td>{delivery?.pdfUrl ? <a className="underline" href={delivery.pdfUrl} target="_blank" rel="noreferrer">download</a> : "—"}</td>
                      <td>
                        <form action={`/api/admin/b2b-orders/${order.shopifyOrderId}`} method="post" className="flex flex-wrap gap-2">
                          <Button name="action" value="confirm_payment" size="sm" variant="outline">Confirm</Button>
                          <Button name="action" value="needs_review" size="sm" variant="outline">Review</Button>
                          <Button name="action" value="regenerate_invoice" size="sm" variant="outline">Regenerate</Button>
                          <Button name="action" value="resend_invoice" size="sm" variant="outline">Resend</Button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {orders.length === 0 && <p className="py-6 text-zinc-500">No B2B orders yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
