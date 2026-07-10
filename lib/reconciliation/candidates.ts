import { prisma } from "@/lib/db";
import { getB2BAttributesFromOrder } from "@/lib/b2b/attributes";
import { upsertB2BOrder } from "@/lib/b2b/orders";
import type { MatchCandidate } from "@/lib/reconciliation/matcher";
import { getShopifyOrder } from "@/lib/shopify/b2b-admin";
import { getEnv } from "@/lib/env";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";

const OPEN_B2B_STATUSES = [
  "INVOICE_SENT",
  "WAITING_BANK_PAYMENT",
  "CREATED",
  "NEEDS_REVIEW",
] as const;

const SHOPIFY_OPEN_ORDERS_QUERY = `
  query OpenBankInvoiceOrders {
    orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "tag:WAITING_IBAN_PAYMENT financial_status:pending") {
      nodes {
        id
        name
        totalPriceSet { shopMoney { amount currencyCode } }
        invoiceNumber: metafield(namespace: "kayer_b2b", key: "invoice_number") { value }
        fopName: metafield(namespace: "kayer_b2b", key: "fop_name") { value }
      }
    }
  }
`;

type ShopifyOpenOrderNode = {
  id: string;
  name: string;
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  invoiceNumber?: { value?: string | null } | null;
  fopName?: { value?: string | null } | null;
};

async function fetchShopifyOpenBankInvoiceCandidates(): Promise<MatchCandidate[]> {
  const env = getEnv();
  const domain = env.SHOPIFY_SHOP_DOMAIN;
  const token = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!domain || !token) return [];

  const response = await fetch(`https://${domain}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query: SHOPIFY_OPEN_ORDERS_QUERY }),
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as {
    data?: { orders?: { nodes?: ShopifyOpenOrderNode[] } };
  };

  return (payload.data?.orders?.nodes ?? []).map((node) => ({
    shopifyOrderId: node.id.replace("gid://shopify/Order/", ""),
    shopifyOrderName: node.name,
    invoiceNumber: node.invoiceNumber?.value?.trim() || null,
    fopName: node.fopName?.value?.trim() || null,
    amount: Number(node.totalPriceSet?.shopMoney?.amount ?? 0),
    currency: node.totalPriceSet?.shopMoney?.currencyCode ?? "UAH",
  }));
}

export async function buildBankReconciliationCandidates(): Promise<{
  candidates: MatchCandidate[];
  openOrders: Awaited<ReturnType<typeof prisma.b2BOrder.findMany>>;
  invoiceByOrder: Map<string, { number: string | null }>;
  stats: { prismaOrders: number; shopifyOrders: number; merged: number };
}> {
  const openOrders = await prisma.b2BOrder.findMany({
    where: { status: { in: [...OPEN_B2B_STATUSES] } },
  });
  const invoices = await prisma.b2BDocument.findMany({
    where: {
      type: "invoice",
      shopifyOrderId: { in: openOrders.map((order) => order.shopifyOrderId) },
    },
  });
  const invoiceByOrder = new Map(invoices.map((invoice) => [invoice.shopifyOrderId, invoice]));

  const prismaCandidates: MatchCandidate[] = openOrders.map((order) => ({
    shopifyOrderId: order.shopifyOrderId,
    shopifyOrderName: order.shopifyOrderName,
    invoiceNumber: invoiceByOrder.get(order.shopifyOrderId)?.number,
    fopName: order.fopName,
    amount: Number(order.orderTotalAmount ?? 0),
    currency: order.orderCurrency ?? "UAH",
  }));

  const shopifyCandidates = await fetchShopifyOpenBankInvoiceCandidates();
  const merged = new Map<string, MatchCandidate>();
  for (const candidate of [...prismaCandidates, ...shopifyCandidates]) {
    const existing = merged.get(candidate.shopifyOrderId);
    if (!existing) {
      merged.set(candidate.shopifyOrderId, candidate);
      continue;
    }
    merged.set(candidate.shopifyOrderId, {
      ...existing,
      shopifyOrderName: existing.shopifyOrderName ?? candidate.shopifyOrderName,
      invoiceNumber: existing.invoiceNumber ?? candidate.invoiceNumber,
      fopName: existing.fopName ?? candidate.fopName,
      amount: existing.amount > 0 ? existing.amount : candidate.amount,
      currency: existing.currency || candidate.currency,
    });
  }

  return {
    candidates: [...merged.values()],
    openOrders,
    invoiceByOrder,
    stats: {
      prismaOrders: prismaCandidates.length,
      shopifyOrders: shopifyCandidates.length,
      merged: merged.size,
    },
  };
}

export async function ensureB2BOrderRecord(input: {
  shopifyOrderId: string;
  shopDomain?: string | null;
  fallbackStatus?: string;
}) {
  const existing = await prisma.b2BOrder.findUnique({
    where: { shopifyOrderId: input.shopifyOrderId },
  });
  if (existing) return existing;

  const shopDomain = input.shopDomain ?? getEnv().SHOPIFY_SHOP_DOMAIN ?? undefined;
  const order = (await getShopifyOrder({
    shopDomain,
    orderId: input.shopifyOrderId,
  })) as ShopifyOrderPayload;
  const buyer = getB2BAttributesFromOrder(order);
  if (buyer.buyer_type !== "fop_company" || buyer.payment_preference !== "bank_invoice") {
    return null;
  }

  return upsertB2BOrder(order, buyer, input.fallbackStatus ?? "WAITING_BANK_PAYMENT");
}
