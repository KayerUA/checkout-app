import { prisma } from "@/lib/db";
import { createPdfFromHtml } from "@/lib/documents/pdf";
import { isPrismaUniqueConstraintError } from "@/lib/documents/b2b-document";
import { renderDeliveryNoteHtml } from "@/lib/documents/templates";
import { uploadPrivateDocument } from "@/lib/supabase/storage";
import type { B2BDocumentInput, FopOrderAttributes, ShopifyOrderPayload } from "@/lib/b2b/types";

export async function getOrCreateDeliveryNoteDocument(input: {
  order: ShopifyOrderPayload;
  buyer: FopOrderAttributes;
  invoiceNumber: string;
}) {
  const shopifyOrderId = String(input.order.id);
  const existing = await prisma.b2BDocument.findFirst({
    where: { shopifyOrderId, type: "delivery_note" },
    orderBy: { createdAt: "asc" },
  });
  if (existing?.pdfUrl) {
    return { document: existing, pdf: null, created: false };
  }

  const docInput: B2BDocumentInput = {
    shopifyOrderId,
    shopifyOrderName: input.order.name,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: new Date(),
    buyer: input.buyer,
    amount: Number(input.order.total_price ?? 0),
    currency: input.order.currency ?? "UAH",
    lines: input.order.line_items ?? [],
    paymentPurpose: "",
  };
  const html = renderDeliveryNoteHtml(docInput);
  const pdf = await createPdfFromHtml(html);
  const number = existing?.number ?? `VN-${input.invoiceNumber}`;
  const pdfUrl = await uploadPrivateDocument({
    path: `${shopifyOrderId}/delivery-note-${number}.pdf`,
    contentType: "application/pdf",
    body: pdf,
  });

  if (existing) {
    const document = await prisma.b2BDocument.update({
      where: { id: existing.id },
      data: { number, status: "CREATED", pdfUrl, metadata: { html } },
    });
    return { document, pdf, created: true };
  }

  try {
    const document = await prisma.b2BDocument.create({
      data: {
        shopifyOrderId,
        type: "delivery_note",
        number,
        status: "CREATED",
        pdfUrl,
        metadata: { html },
      },
    });
    return { document, pdf, created: true };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;
    const document = await prisma.b2BDocument.findFirst({
      where: { shopifyOrderId, type: "delivery_note" },
      orderBy: { createdAt: "asc" },
    });
    if (!document) throw error;
    const updated = await prisma.b2BDocument.update({
      where: { id: document.id },
      data: {
        status: "CREATED",
        pdfUrl: document.pdfUrl || pdfUrl,
        metadata: { html },
      },
    });
    return { document: updated, pdf: null, created: false };
  }
}
