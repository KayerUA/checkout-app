import { prisma } from "@/lib/db";
import { createInvoicePdf } from "@/lib/documents/invoice-pdf";
import { isPrismaUniqueConstraintError } from "@/lib/documents/b2b-document";
import { invoicePaymentPurpose, renderInvoiceHtml } from "@/lib/documents/templates";
import { uploadPrivateDocument } from "@/lib/supabase/storage";
import { fetchDilovodInvoiceNamesBySku, resolveLineInvoiceTitle } from "@/lib/shopify/variant-invoice-names";
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

async function nextInvoiceSequenceNumber(date = new Date()) {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const count = await prisma.b2BDocument.count({
    where: {
      type: "invoice",
      createdAt: { gte: yearStart },
    },
  });
  return generateInvoiceNumber(count + 1, date);
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

  const invoiceNumber = existing?.number ?? (await nextInvoiceSequenceNumber());
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

  if (existing) {
    const document = await prisma.b2BDocument.update({
      where: { id: existing.id },
      data: {
        number: invoiceNumber,
        status: "CREATED",
        pdfUrl,
        metadata: { paymentPurpose, html, input },
      },
    });
    return { document, pdf, paymentPurpose, created: true };
  }

  try {
    const document = await prisma.b2BDocument.create({
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
  } catch (error) {
    // Concurrent orders/create for the same Shopify order (P2002 on shopify_order_id+type+number).
    if (!isPrismaUniqueConstraintError(error)) throw error;
    const document = await prisma.b2BDocument.findFirst({
      where: { shopifyOrderId, type: "invoice" },
      orderBy: { createdAt: "asc" },
    });
    if (!document) throw error;
    const updated = await prisma.b2BDocument.update({
      where: { id: document.id },
      data: {
        status: "CREATED",
        pdfUrl: document.pdfUrl || pdfUrl,
        metadata: { paymentPurpose, html, input },
      },
    });
    return {
      document: updated,
      pdf: null,
      paymentPurpose: invoicePaymentPurpose(
        updated.number ?? invoiceNumber,
        updated.createdAt,
        order.name
      ),
      created: false,
    };
  }
}
