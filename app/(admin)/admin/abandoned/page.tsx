import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
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
        title="Покинуті checkout"
        description="Контакти й кошики клієнтів, які не завершили оплату. Платіжні спроби зберігаються окремо й очищаються після перевірки провайдера."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>{abandoned.length} незавершених checkout</CardTitle>
        </CardHeader>
        <CardContent>
          {abandoned.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клієнт</TableHead>
                  <TableHead>Контакти</TableHead>
                  <TableHead>Сума</TableHead>
                  <TableHead>Кошик</TableHead>
                  <TableHead>Остання активність</TableHead>
                  <TableHead className="text-right">Дія</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abandoned.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">
                      {[session.buyerFirstName, session.buyerLastName].filter(Boolean).join(" ") || "Без імені"}
                    </TableCell>
                    <TableCell>
                      <div>{session.buyerPhone || "Телефон не вказано"}</div>
                      <div className="text-muted-foreground">{session.buyerEmail || "Email не вказано"}</div>
                    </TableCell>
                    <TableCell>{formatMoney(session.totalAmount, session.currency)}</TableCell>
                    <TableCell className="max-w-72">
                      {session.lines.map((line) => `${line.quantity}× ${line.title}`).join(", ") || "Кошик порожній"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {(session.abandonedAt ?? session.updatedAt).toISOString().slice(0, 16)}
                    </TableCell>
                    <TableCell className="text-right">
                      <a href={`/checkout/${session.publicToken}`} className="font-medium underline underline-offset-4" target="_blank" rel="noreferrer">
                        Відкрити
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="Немає покинутих checkout" description="Тут з’являться контакти та кошики після години без активності." icon={<ShoppingCart className="size-4" />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
