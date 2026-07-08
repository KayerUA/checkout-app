import { prisma } from "@/lib/db";
import { createInvoicePdf } from "@/lib/documents/invoice-pdf";
import { invoicePaymentPurpose, renderInvoiceHtml } from "@/lib/documents/templates";
import { uploadPrivateDocument } from "@/lib/supabase/storage";
import type { B2BDocumentInput, FopOrderAttributes, ShopifyOrderLine, ShopifyOrderPayload } from "@/lib/b2b/types";

async function invoiceDocumentLines(
  lines: ShopifyOrderLine[],
  shopDomain?: string | null
): Promise<ShopifyOrderLine[]> {
  const dilovodNamesBySku = await fetchDilovodInvoiceNamesBySku(
    shopDomain,
    lines.map((line) => line.sku)
  );
  return lines.map((line) => ({
    ...line,
    title: resolveLineInvoiceTitle({
      storefrontTitle: line.title,
      sku: line.sku,
      dilovodNamesBySku,
      metadata: { dilovodInvoiceName: line.dilovodInvoiceName },
    }),
  }));
}

export function invoiceGoodsAmount(order: ShopifyOrderPayload) {
  return (order.line_items ?? []).reduce((sum, line) => {
    const unit = Number(line.price_set?.shop_money?.amount ?? line.price ?? 0);
    const quantity = Number(line.quantity);
    return sum + unit * quantity;
  }, 0);
}

export function generateInvoiceNumber(sequence: number, date = new Date()) {
  return `KAYER-UA-${date.getFullYear()}-${String(sequence).padStart(6, "0")}`;
}

export async function getOrCreateInvoiceDocument(
  order: ShopifyOrderPayload,
  buyer: FopOrderAttributes,
  shopDomain?: string | null
) {
  const shopifyOrderId = String(order.id);
  const existing = await prisma.b2BDocument.findFirst({
    where: { shopifyOrderId, type: "invoice" },
    orderBy: { createdAt: "asc" },
  });
  if (existing?.number && existing.pdfUrl) {
    return {
      document: existing,
      pdf: null,
      paymentPurpose: invoicePaymentPurpose(existing.number, existing.createdAt, order.name),
      created: false,
    };
  }

  const sequence = await prisma.b2BDocument.count({
    where: {
      type: "invoice",
      createdAt: {
        gte: new Date(new Date().getFullYear(), 0, 1),
      },
    },
  });
  const invoiceNumber = existing?.number ?? generateInvoiceNumber(sequence + 1);
  const invoiceDate = existing?.createdAt ?? new Date();
  const paymentPurpose = invoicePaymentPurpose(invoiceNumber, invoiceDate, order.name);
  const documentLines = await invoiceDocumentLines(
    order.line_items ?? [],
    shopDomain ?? order.myshopify_domain ?? order.shop_domain
  );
  const input: B2BDocumentInput = {
    shopifyOrderId,
    shopifyOrderName: order.name,
    invoiceNumber,
    invoiceDate,
    buyer,
    amount: invoiceGoodsAmount({ ...order, line_items: documentLines }),
    currency: order.currency ?? "UAH",
    lines: documentLines,
    paymentPurpose,
  };
  const html = renderInvoiceHtml(input);
  const pdf = await createInvoicePdf(input);
  const pdfUrl = await uploadPrivateDocument({
    path: `${shopifyOrderId}/invoice-${invoiceNumber}.pdf`,
    contentType: "application/pdf",
    body: pdf,
  });

  const document = existing
    ? await prisma.b2BDocument.update({
        where: { id: existing.id },
        data: {
          number: invoiceNumber,
          status: "CREATED",
          pdfUrl,
          metadata: { paymentPurpose, html, input },
        },
      })
    : await prisma.b2BDocument.create({
        data: {
          shopifyOrderId,
          type: "invoice",
          number: invoiceNumber,
          status: "CREATED",
          pdfUrl,
          metadata: { paymentPurpose, html, input },
        },
      });

  return { document, pdf, paymentPurpose, created: true };
}
