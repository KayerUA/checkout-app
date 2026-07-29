import { prisma } from "@/lib/db";
import { createInvoicePdf } from "@/lib/documents/invoice-pdf";
import { isPrismaUniqueConstraintError } from "@/lib/documents/b2b-document";
import { invoicePaymentPurpose, renderInvoiceHtml } from "@/lib/documents/templates";
import { uploadPrivateDocument } from "@/lib/supabase/storage";
import { fetchDilovodInvoiceNamesBySku, resolveLineInvoiceTitle } from "@/lib/shopify/variant-invoice-names";
import type { B2BDocumentInput, FopOrderAttributes, ShopifyOrderLine, ShopifyOrderPayload } from "@/lib/b2b/types";

type ShopifyOrderDiscountTotals = {
  total_line_items_price?: string | number | null;
  total_discounts?: string | number | null;
  subtotal_price?: string | number | null;
};

function moneyCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : null;
}

function lineGrossCents(line: ShopifyOrderLine) {
  const unit = Number(line.price_set?.shop_money?.amount ?? line.price ?? 0);
  const quantity = Number(line.quantity);
  if (!Number.isFinite(unit) || !Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.max(0, Math.round(unit * quantity * 100));
}

function allocateProportionally(bases: number[], target: number) {
  const normalized = bases.map((base) => Math.max(0, Math.round(base)));
  const subtotal = normalized.reduce((sum, base) => sum + base, 0);
  const cappedTarget = Math.min(subtotal, Math.max(0, Math.round(target)));
  if (subtotal <= 0) return normalized.map(() => 0);

  const raw = normalized.map((base) => (base * cappedTarget) / subtotal);
  const allocated = raw.map(Math.floor);
  let remainder = cappedTarget - allocated.reduce((sum, amount) => sum + amount, 0);
  const priority = raw
    .map((amount, index) => ({ index, fraction: amount - allocated[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (const row of priority) {
    if (remainder <= 0) break;
    if (allocated[row.index] >= normalized[row.index]) continue;
    allocated[row.index] += 1;
    remainder -= 1;
  }
  return allocated;
}

function discountedGoodsTargetCents(order: ShopifyOrderPayload, grossCents: number) {
  const totals = order as ShopifyOrderPayload & ShopifyOrderDiscountTotals;
  const lineItemsCents = moneyCents(totals.total_line_items_price);
  const discountsCents = moneyCents(totals.total_discounts);
  if (lineItemsCents !== null && discountsCents !== null) {
    return Math.min(grossCents, Math.max(0, lineItemsCents - discountsCents));
  }

  const subtotalCents = moneyCents(totals.subtotal_price);
  if (subtotalCents !== null && subtotalCents <= grossCents) return subtotalCents;

  // The synchronous checkout invoice payload historically only carried
  // total_price. B2B checkout does not add Nova Poshta delivery to the order,
  // so a lower order total is a safe legacy signal for a cart-level discount.
  const orderTotalCents = moneyCents(order.total_price);
  if (orderTotalCents !== null && orderTotalCents <= grossCents) return orderTotalCents;
  return grossCents;
}

export function invoiceDiscountedLines(order: ShopifyOrderPayload): ShopifyOrderLine[] {
  const lines = order.line_items ?? [];
  const grossByLine = lines.map(lineGrossCents);
  const grossCents = grossByLine.reduce((sum, amount) => sum + amount, 0);
  const netByLine = allocateProportionally(
    grossByLine,
    discountedGoodsTargetCents(order, grossCents)
  );

  return lines.map((line, index) => {
    const quantity = Number(line.quantity);
    const unit =
      Number.isFinite(quantity) && quantity > 0
        ? netByLine[index] / 100 / quantity
        : 0;
    const amount = unit.toFixed(6);
    return {
      ...line,
      price: amount,
      price_set: {
        ...line.price_set,
        shop_money: {
          ...line.price_set?.shop_money,
          amount,
        },
      },
    };
  });
}

async function invoiceDocumentLines(
  order: ShopifyOrderPayload,
  shopDomain?: string | null
): Promise<ShopifyOrderLine[]> {
  const lines = invoiceDiscountedLines(order);
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
  const cents = (order.line_items ?? []).reduce((sum, line) => {
    const unit = Number(line.price_set?.shop_money?.amount ?? line.price ?? 0);
    const quantity = Number(line.quantity);
    return sum + Math.round(unit * quantity * 100);
  }, 0);
  return cents / 100;
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
  const discountedLines = invoiceDiscountedLines(order);
  const expectedAmount = invoiceGoodsAmount({
    ...order,
    line_items: discountedLines,
  });
  const existing = await prisma.b2BDocument.findFirst({
    where: { shopifyOrderId, type: "invoice" },
    orderBy: { createdAt: "asc" },
  });
  if (existing?.number && existing.pdfUrl) {
    const metadata = existing.metadata as { input?: B2BDocumentInput } | null;
    const storedAmount = Number(metadata?.input?.amount);
    if (
      Number.isFinite(storedAmount) &&
      Math.round(storedAmount * 100) === Math.round(expectedAmount * 100)
    ) {
      return {
        document: existing,
        pdf: null,
        paymentPurpose: invoicePaymentPurpose(existing.number, existing.createdAt, order.name),
        created: false,
      };
    }
  }

  const invoiceNumber = existing?.number ?? (await nextInvoiceSequenceNumber());
  const invoiceDate = existing?.createdAt ?? new Date();
  const paymentPurpose = invoicePaymentPurpose(invoiceNumber, invoiceDate, order.name);
  const documentLines = await invoiceDocumentLines(
    order,
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
        metadata: {
          paymentPurpose,
          html,
          input,
          correctedAt: new Date().toISOString(),
        },
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
