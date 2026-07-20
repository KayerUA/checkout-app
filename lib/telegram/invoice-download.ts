import { prisma } from "@/lib/db";
import { createInvoicePdf } from "@/lib/documents/invoice-pdf";
import { createPdfFromHtml } from "@/lib/documents/pdf";
import { freshDocumentDownloadUrl, uploadPrivateDocument } from "@/lib/supabase/storage";
import type { B2BDocumentInput } from "@/lib/b2b/types";

export type TelegramInvoiceDownload = {
  shopifyOrderId: string;
  orderName: string;
  number: string;
  url: string;
  filename: string;
};

export async function resolveInvoicePdfForTelegram(
  shopifyOrderId: string
): Promise<TelegramInvoiceDownload | { error: string }> {
  const id = String(shopifyOrderId).trim();
  if (!/^\d+$/.test(id)) return { error: "Некорректный Shopify order id" };

  const [invoice, b2bOrder, orderLink] = await Promise.all([
    prisma.b2BDocument.findFirst({
      where: { shopifyOrderId: id, type: "invoice" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.b2BOrder.findUnique({
      where: { shopifyOrderId: id },
      select: { shopifyOrderName: true },
    }),
    prisma.orderLink.findFirst({
      where: { shopifyOrderGid: `gid://shopify/Order/${id}` },
      select: { shopifyOrderName: true },
    }),
  ]);
  if (!invoice?.number) {
    return { error: "Счёт для этого заказа ещё не создан в B2B documents" };
  }
  const orderName =
    (b2bOrder?.shopifyOrderName || orderLink?.shopifyOrderName || "").trim() || `UA order ${id}`;

  const storagePath = `${id}/invoice-${invoice.number}.pdf`;
  let url = await freshDocumentDownloadUrl({
    path: storagePath,
    pdfUrl: invoice.pdfUrl,
  });

  if (!url) {
    const metadata = (invoice.metadata ?? {}) as { html?: unknown; input?: B2BDocumentInput };
    const input = metadata.input;
    const html = typeof metadata.html === "string" ? metadata.html : null;
    if (!input && !html) {
      return { error: `Счёт ${invoice.number} есть, но PDF недоступен (нет файла и нет HTML в metadata)` };
    }
    const pdf = input ? await createInvoicePdf(input) : await createPdfFromHtml(html ?? "");
    url = await uploadPrivateDocument({
      path: storagePath,
      contentType: "application/pdf",
      body: pdf,
    });
    if (!url.startsWith("http")) {
      return { error: "Не удалось получить публичную ссылку на PDF (Supabase)" };
    }
    await prisma.b2BDocument.update({
      where: { id: invoice.id },
      data: {
        status: "CREATED",
        pdfUrl: url,
        metadata: {
          ...(typeof invoice.metadata === "object" && invoice.metadata ? invoice.metadata : {}),
          regeneratedFromTelegramAt: new Date().toISOString(),
        },
      },
    });
  }

  return {
    shopifyOrderId: id,
    orderName,
    number: invoice.number,
    url,
    filename: `${invoice.number}.pdf`,
  };
}
