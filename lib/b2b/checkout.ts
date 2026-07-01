import { prisma } from "@/lib/db";
import { handleB2BOrderCreated } from "@/lib/b2b/orders";
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
  const order: ShopifyOrderPayload = {
    id: shopifyOrderId,
    admin_graphql_api_id: session.orderLink.shopifyOrderGid,
    name: session.orderLink.shopifyOrderName ?? undefined,
    email: session.buyerEmail ?? undefined,
    contact_email: session.buyerEmail ?? undefined,
    myshopify_domain: session.merchant.shopDomain,
    total_price: String((session.totalAmount / 100).toFixed(2)),
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
    line_items: session.lines.map((line) => ({
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      price: String((line.unitPrice / 100).toFixed(2)),
      price_set: {
        shop_money: {
          amount: String((line.unitPrice / 100).toFixed(2)),
          currency_code: session.currency,
        },
      },
    })),
  };

  return handleB2BOrderCreated(order, session.merchant.shopDomain);
}
