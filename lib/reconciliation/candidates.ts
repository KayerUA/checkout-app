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
        invoiceAmount: metafield(namespace: "kayer_b2b", key: "invoice_amount_uah") { value }
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
  invoiceAmount?: { value?: string | null } | null;
  fopName?: { value?: string | null } | null;
};

type RankedMatchCandidate = MatchCandidate & { amountPriority: number };

function positiveAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function invoiceAmountFromDocumentMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const input = (metadata as Record<string, unknown>).input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return positiveAmount((input as Record<string, unknown>).amount);
}

export function mergeBankReconciliationCandidates(
  candidates: RankedMatchCandidate[]
): MatchCandidate[] {
  const merged = new Map<string, RankedMatchCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.shopifyOrderId);
    if (!existing) {
      merged.set(candidate.shopifyOrderId, candidate);
      continue;
    }
    const preferCandidateAmount = candidate.amountPriority > existing.amountPriority;
    merged.set(candidate.shopifyOrderId, {
      ...existing,
      shopifyOrderName: existing.shopifyOrderName ?? candidate.shopifyOrderName,
      invoiceNumber: existing.invoiceNumber ?? candidate.invoiceNumber,
      fopName: existing.fopName ?? candidate.fopName,
      amount: preferCandidateAmount ? candidate.amount : existing.amount,
      currency: preferCandidateAmount ? candidate.currency : existing.currency,
      amountPriority: Math.max(existing.amountPriority, candidate.amountPriority),
    });
  }
  return [...merged.values()].map((candidate) => ({
    shopifyOrderId: candidate.shopifyOrderId,
    shopifyOrderName: candidate.shopifyOrderName,
    invoiceNumber: candidate.invoiceNumber,
    fopName: candidate.fopName,
    amount: candidate.amount,
    currency: candidate.currency,
  }));
}

async function fetchShopifyOpenBankInvoiceCandidates(): Promise<RankedMatchCandidate[]> {
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

  return (payload.data?.orders?.nodes ?? []).map((node) => {
    const invoiceAmount = positiveAmount(node.invoiceAmount?.value);
    return {
      shopifyOrderId: node.id.replace("gid://shopify/Order/", ""),
      shopifyOrderName: node.name,
      invoiceNumber: node.invoiceNumber?.value?.trim() || null,
      fopName: node.fopName?.value?.trim() || null,
      amount: invoiceAmount ?? Number(node.totalPriceSet?.shopMoney?.amount ?? 0),
      currency: node.totalPriceSet?.shopMoney?.currencyCode ?? "UAH",
      amountPriority: invoiceAmount ? 3 : 2,
    };
  });
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

  const prismaCandidates: RankedMatchCandidate[] = openOrders.map((order) => {
    const invoice = invoiceByOrder.get(order.shopifyOrderId);
    const invoiceAmount = invoiceAmountFromDocumentMetadata(invoice?.metadata);
    return {
      shopifyOrderId: order.shopifyOrderId,
      shopifyOrderName: order.shopifyOrderName,
      invoiceNumber: invoice?.number,
      fopName: order.fopName,
      amount: invoiceAmount ?? Number(order.orderTotalAmount ?? 0),
      currency: order.orderCurrency ?? "UAH",
      amountPriority: invoiceAmount ? 3 : 1,
    };
  });

  const shopifyCandidates = await fetchShopifyOpenBankInvoiceCandidates();
  const candidates = mergeBankReconciliationCandidates([
    ...prismaCandidates,
    ...shopifyCandidates,
  ]);

  return {
    candidates,
    openOrders,
    invoiceByOrder,
    stats: {
      prismaOrders: prismaCandidates.length,
      shopifyOrders: shopifyCandidates.length,
      merged: candidates.length,
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
