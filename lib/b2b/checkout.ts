import { prisma } from "@/lib/db";
import { handleB2BOrderCreated } from "@/lib/b2b/orders";
import {
  fetchDilovodInvoiceNamesBySku,
  fetchVariantDilovodInvoiceNames,
  resolveLineInvoiceTitle,
} from "@/lib/shopify/variant-invoice-names";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";

export async function ensureB2BInvoiceForCheckoutSession(publicToken: string) {
  const session = await prisma.checkoutSession.findUnique({
    where: { publicToken },
    include: { lines: true, merchant: true, orderLink: true },
  });
  if (!session?.orderLink?.shopifyOrderGid) return { skipped: true };

  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  if (attrs.buyer_type !== "fop_company" || attrs.payment_preference !== "bank_invoice") {
    return { skipped: true };
  }

  const shopifyOrderId = session.orderLink.shopifyOrderGid.replace("gid://shopify/Order/", "");
  const [dilovodNamesByVariantGid, dilovodNamesBySku] = await Promise.all([
    fetchVariantDilovodInvoiceNames(
      session.merchant.shopDomain,
      session.lines.map((line) => line.variantGid)
    ),
    fetchDilovodInvoiceNamesBySku(
      session.merchant.shopDomain,
      session.lines.map((line) => line.sku)
    ),
  ]);
  const order: ShopifyOrderPayload = {
    id: shopifyOrderId,
    admin_graphql_api_id: session.orderLink.shopifyOrderGid,
    name: session.orderLink.shopifyOrderName ?? undefined,
    email: session.buyerEmail ?? undefined,
    contact_email: session.buyerEmail ?? undefined,
    myshopify_domain: session.merchant.shopDomain,
    total_price: String((session.totalAmount / 100).toFixed(2)),
    ...({
      // Shopify's webhook payload normally supplies these fields. Keep the
      // synchronous bank-invoice path equivalent so invoice rows include
      // cart-level promo discounts before the webhook arrives.
      total_line_items_price: String((session.subtotal / 100).toFixed(2)),
      total_discounts: String((session.discountAmount / 100).toFixed(2)),
    } as Record<string, string>),
    currency: session.currency,
    note_attributes: [
      { name: "buyer_type", value: String(attrs.buyer_type ?? "") },
      { name: "payment_preference", value: String(attrs.payment_preference ?? "") },
      { name: "fop_name", value: String(attrs.fop_name ?? "") },
      { name: "fop_tax_id", value: String(attrs.fop_tax_id ?? "") },
      { name: "fop_legal_address", value: String(attrs.fop_legal_address ?? "") },
      { name: "docs_email", value: String(attrs.docs_email ?? session.buyerEmail ?? "") },
      { name: "docs_phone", value: String(attrs.docs_phone ?? session.buyerPhone ?? "") },
      { name: "accounting_comment", value: String(attrs.accounting_comment ?? "") },
    ],
    line_items: session.lines.map((line) => {
      const invoiceTitle = resolveLineInvoiceTitle({
        storefrontTitle: line.title,
        variantGid: line.variantGid,
        metadata: line.metadata,
        sku: line.sku,
        dilovodNamesByVariantGid,
        dilovodNamesBySku,
      });
      return {
        sku: line.sku,
        title: invoiceTitle,
        dilovodInvoiceName: invoiceTitle !== line.title ? invoiceTitle : null,
        quantity: line.quantity,
        price: String((line.unitPrice / 100).toFixed(2)),
        price_set: {
          shop_money: {
            amount: String((line.unitPrice / 100).toFixed(2)),
            currency_code: session.currency,
          },
        },
      };
    }),
  };

  return handleB2BOrderCreated(order, session.merchant.shopDomain);
}
