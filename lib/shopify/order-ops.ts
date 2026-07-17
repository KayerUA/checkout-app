import { getEnv } from "@/lib/env";

export type ShopifyOpsOrder = {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  fullyPaid: boolean;
  email?: string | null;
  phone?: string | null;
  totalPriceSet?: { shopMoney?: { amount: string; currencyCode: string } | null } | null;
  currentTotalPriceSet?: { shopMoney?: { amount: string; currencyCode: string } | null } | null;
  customer?: {
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  shippingAddress?: {
    city?: string | null;
    zip?: string | null;
    address1?: string | null;
    phone?: string | null;
  } | null;
  fulfillments?: Array<{
    status?: string | null;
    trackingInfo?: Array<{ number?: string | null; url?: string | null }>;
  }>;
  transactions?: Array<{
    id: string;
    kind: string;
    status: string;
    gateway?: string | null;
    processedAt?: string | null;
    amountSet?: { shopMoney?: { amount: string; currencyCode: string } | null } | null;
  }>;
  refunds?: Array<{
    id: string;
    createdAt: string;
    note?: string | null;
    totalRefundedSet?: { shopMoney?: { amount: string; currencyCode: string } | null } | null;
  }>;
};

type OrdersResponse = {
  data?: { orders?: { nodes?: ShopifyOpsOrder[] } };
  errors?: Array<{ message: string }>;
};

function searchQuery(reference: string) {
  const value = reference.trim().replace(/^#/, "");
  if (/^\d{9,}$/.test(value)) return `id:${value}`;
  return `name:${value}`;
}

export async function findShopifyOpsOrder(reference: string): Promise<ShopifyOpsOrder | null> {
  const env = getEnv();
  if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) return null;
  const response = await fetch(
    `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query: `query TelegramOrder($query: String!) {
          orders(first: 1, query: $query) {
            nodes {
              id legacyResourceId name createdAt
              displayFinancialStatus displayFulfillmentStatus fullyPaid
              email phone
              totalPriceSet { shopMoney { amount currencyCode } }
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              customer { displayName email phone }
              shippingAddress { city zip address1 phone }
              fulfillments { status trackingInfo { number url } }
              transactions {
                id kind status gateway processedAt
                amountSet { shopMoney { amount currencyCode } }
              }
              refunds {
                id createdAt note
                totalRefundedSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }`,
        variables: { query: searchQuery(reference) },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok) throw new Error(`Shopify order lookup failed with ${response.status}`);
  const payload = (await response.json()) as OrdersResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  return payload.data?.orders?.nodes?.[0] ?? null;
}

export function shopifyAdminOrderUrl(orderId: string) {
  const domain = getEnv().SHOPIFY_SHOP_DOMAIN;
  if (!domain || !orderId) return null;
  const slug = domain.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${slug}/orders/${orderId}`;
}
