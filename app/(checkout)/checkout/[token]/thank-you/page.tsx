import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCheckoutSessionByToken } from "@/lib/checkout/session-service";
import { formatMoney } from "@/lib/checkout/pricing";
import { prisma } from "@/lib/db";
import { ensureB2BInvoiceForCheckoutSession } from "@/lib/b2b/checkout";
import { BRAND, CheckoutHeader } from "@/components/checkout/checkout-header";
import { CheckoutFooter } from "@/components/checkout/checkout-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, CheckCircle2, Download, ExternalLink, FileText, Package } from "lucide-react";

export const metadata = {
  title: "Дякуємо за замовлення — KAYER",
};

export default async function ThankYouPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getCheckoutSessionByToken(token);
  if (!session) notFound();

  if (!["PAID", "COMPLETED"].includes(session.status) && session.orderLink === null) {
    redirect(`/checkout/${token}`);
  }

  const fiscal = session.orderLink?.fiscalReceipt;
  const shippingPayload = session.shippingPayload as Record<string, string> | null;
  const attrs = (session.customAttributes ?? {}) as Record<string, string>;
  const isBankInvoice =
    session.paymentProvider === "BANK_INVOICE" ||
    attrs.payment_preference === "bank_invoice";

  let invoiceError: string | null = null;
  if (isBankInvoice) {
    try {
      await ensureB2BInvoiceForCheckoutSession(token);
    } catch (error) {
      invoiceError = error instanceof Error ? error.message : "Не вдалося створити рахунок";
    }
  }

  const b2bOrder = session.orderLink?.shopifyOrderGid
    ? await prisma.b2BOrder.findUnique({
        where: {
          shopifyOrderId: session.orderLink.shopifyOrderGid.replace("gid://shopify/Order/", ""),
        },
      })
    : null;
  const invoice = b2bOrder
    ? await prisma.b2BDocument.findFirst({
        where: { shopifyOrderId: b2bOrder.shopifyOrderId, type: "invoice" },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const invoiceMetadata = invoice?.metadata as Record<string, unknown> | null;
  const paymentPurpose =
    typeof invoiceMetadata?.paymentPurpose === "string" ? invoiceMetadata.paymentPurpose : null;

  return (
    <>
      <CheckoutHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-2xl space-y-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10">
            {isBankInvoice ? (
              <FileText className="size-8 text-primary" />
            ) : (
              <CheckCircle2 className="size-8 text-primary" />
            )}
          </div>

          <div className="space-y-2">
            <Badge variant="secondary" className="uppercase tracking-wider">
              {isBankInvoice ? "Очікуємо оплату за рахунком" : "Замовлення прийнято"}
            </Badge>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {isBankInvoice
                ? invoice?.pdfUrl
                  ? "Рахунок готовий до оплати"
                  : "Рахунок для оплати створюється"
                : "Дякуємо за покупку!"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isBankInvoice
                ? invoice?.pdfUrl
                  ? "Скачайте рахунок, оплатіть його з підприємницького або юридичного рахунку і вкажіть призначення платежу точно як нижче."
                  : "Ми створюємо рахунок і надішлемо його на email для документів. Замовлення піде в обробку після надходження коштів."
                : "Ми вже отримали ваше замовлення і незабаром почнемо обробку."}
            </p>
          </div>

          <Card className="text-left">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Package className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Деталі замовлення</CardTitle>
              </div>
              <CardDescription>
                {isBankInvoice ? "Оплата за рахунком для ФОП / компанії" : "Підтвердження надіслано на email"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {session.orderLink?.shopifyOrderName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Номер</span>
                  <span className="font-medium">{session.orderLink.shopifyOrderName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Сума</span>
                <span className="font-medium">
                  {formatMoney(session.totalAmount, session.currency)}
                </span>
              </div>
              {isBankInvoice && (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Email для документів</span>
                    <span className="text-right">{attrs.docs_email ?? session.buyerEmail ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Статус</span>
                    <span className="text-right">
                      {invoiceError
                        ? "Потрібна перевірка"
                        : b2bOrder?.status === "WAITING_BANK_PAYMENT"
                        ? "Рахунок надіслано, очікуємо платіж"
                        : b2bOrder?.status ?? "Рахунок створюється"}
                    </span>
                  </div>
                  {invoiceError && (
                    <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <div>
                        <p className="font-medium">Не вдалося автоматично створити рахунок</p>
                        <p className="mt-1 text-xs">{invoiceError}</p>
                      </div>
                    </div>
                  )}
                  {invoice?.number && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Рахунок</span>
                      {invoice.pdfUrl ? (
                        <a
                          href={invoice.pdfUrl}
                          className="inline-flex items-center gap-1 text-right font-medium hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {invoice.number}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="font-medium">{invoice.number}</span>
                      )}
                    </div>
                  )}
                  {paymentPurpose && (
                    <div className="space-y-2">
                      <span className="text-muted-foreground">Призначення платежу</span>
                      <div className="rounded-md border bg-background p-3 font-medium leading-relaxed">
                        {paymentPurpose}
                      </div>
                    </div>
                  )}
                  <Separator />
                  <div className="rounded-md bg-muted p-3 text-sm leading-relaxed">
                    <p className="font-medium">Що далі</p>
                    <p className="mt-1 text-muted-foreground">
                      Оплатіть рахунок саме з рахунку ФОП або компанії. Після автоматичної звірки банк-платежу ми позначимо замовлення як готове до обробки та надішлемо документи для бухгалтерії.
                    </p>
                  </div>
                </>
              )}
              {shippingPayload?.branchName && (
                <div className="flex justify-between gap-4">
                  <span className="shrink-0 text-muted-foreground">Доставка</span>
                  <span className="text-right">{shippingPayload.branchName}</span>
                </div>
              )}
              {fiscal?.status === "DONE" && fiscal.receiptUrl && (
                <>
                  <Separator />
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Фіскальний чек</span>
                    <a
                      href={fiscal.receiptUrl}
                      className="inline-flex items-center gap-1 font-medium hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {fiscal.fiscalNumber ?? "Переглянути"}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-2 sm:flex-row">
              {invoice?.pdfUrl && (
                <Button
                  className="w-full"
                  size="lg"
                  nativeButton={false}
                  render={<a href={invoice.pdfUrl} target="_blank" rel="noreferrer" />}
                >
                  <Download className="size-4" />
                  Скачати рахунок PDF
                </Button>
              )}
              <Button
                className="w-full"
                size="lg"
                variant={invoice?.pdfUrl ? "outline" : "default"}
                nativeButton={false}
                render={<Link href={BRAND.siteUrl} />}
              >
                Повернутися в магазин
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
      <CheckoutFooter />
    </>
  );
}
