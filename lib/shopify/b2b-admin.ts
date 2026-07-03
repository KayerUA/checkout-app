import { getEnv } from "@/lib/env";
import { B2B_METAFIELD_NAMESPACE } from "@/lib/b2b/constants";

function getShopDomain(shopDomain?: string | null) {
  const env = getEnv();
  const domain = shopDomain || env.SHOPIFY_SHOP_DOMAIN;
  if (!domain) throw new Error("SHOPIFY_SHOP_DOMAIN is required");
  return domain;
}

function getAccessToken() {
  const token = getEnv().SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN is required for B2B Shopify updates");
  return token;
}

async function shopifyRest<T>(shopDomain: string | null | undefined, path: string, init: RequestInit = {}) {
  const env = getEnv();
  const domain = getShopDomain(shopDomain);
  const response = await fetch(`https://${domain}/admin/api/${env.SHOPIFY_API_VERSION}/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": getAccessToken(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Shopify Admin REST failed: ${await response.text()}`);
  return (await response.json()) as T;
}

async function shopifyGraphQL<T>(
  shopDomain: string | null | undefined,
  query: string,
  variables: Record<string, unknown>
) {
  const env = getEnv();
  const domain = getShopDomain(shopDomain);
  const response = await fetch(`https://${domain}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": getAccessToken(),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Shopify Admin GraphQL failed: ${await response.text()}`);
  return (await response.json()) as T;
}

function uniqueTags(tags?: string[]) {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)));
}

function orderGid(orderId: string) {
  return orderId.startsWith("gid://shopify/Order/") ? orderId : `gid://shopify/Order/${orderId}`;
}

function assertNoTagUserErrors(
  operation: "tagsAdd" | "tagsRemove",
  result: { data?: Record<string, { userErrors?: Array<{ message: string }> }> }
) {
  const errors = result.data?.[operation]?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`Shopify ${operation} failed: ${errors.map((error) => error.message).join("; ")}`);
  }
}

export async function updateOrderTags(input: {
  shopDomain?: string | null;
  orderId: string;
  add?: string[];
  remove?: string[];
}) {
  const id = orderGid(input.orderId);
  const add = uniqueTags(input.add);
  const remove = uniqueTags(input.remove);

  if (add.length) {
    const result = await shopifyGraphQL<{
      data?: { tagsAdd?: { userErrors: Array<{ message: string }> } };
    }>(
      input.shopDomain,
      `mutation TagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
      { id, tags: add }
    );
    assertNoTagUserErrors("tagsAdd", result);
  }

  if (remove.length) {
    const result = await shopifyGraphQL<{
      data?: { tagsRemove?: { userErrors: Array<{ message: string }> } };
    }>(
      input.shopDomain,
      `mutation TagsRemove($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
      { id, tags: remove }
    );
    assertNoTagUserErrors("tagsRemove", result);
  }
}

export async function setOrderMetafields(input: {
  shopDomain?: string | null;
  orderId: string;
  metafields: Record<string, string | number | boolean | null | undefined>;
}) {
  const existing = await shopifyRest<{ metafields: Array<{ id: number; key: string }> }>(
    input.shopDomain,
    `orders/${input.orderId}/metafields.json?namespace=${B2B_METAFIELD_NAMESPACE}`
  );
  const byKey = new Map(existing.metafields.map((field) => [field.key, field.id]));

  for (const [key, rawValue] of Object.entries(input.metafields)) {
    if (rawValue == null || rawValue === "") continue;
    const value = String(rawValue);
    const existingId = byKey.get(key);
    if (existingId) {
      await shopifyRest(input.shopDomain, `metafields/${existingId}.json`, {
        method: "PUT",
        body: JSON.stringify({
          metafield: { id: existingId, value, type: "single_line_text_field" },
        }),
      });
    } else {
      await shopifyRest(input.shopDomain, `orders/${input.orderId}/metafields.json`, {
        method: "POST",
        body: JSON.stringify({
          metafield: {
            namespace: B2B_METAFIELD_NAMESPACE,
            key,
            value,
            type: "single_line_text_field",
          },
        }),
      });
    }
  }
}

export async function getShopifyOrder(input: { shopDomain?: string | null; orderId: string }) {
  const result = await shopifyRest<{ order: unknown }>(
    input.shopDomain,
    `orders/${input.orderId}.json`
  );
  return result.order;
}

type ShopifyOrderTransaction = {
  id: number;
  kind?: string | null;
  status?: string | null;
  amount?: string | null;
  currency?: string | null;
  gateway?: string | null;
  authorization?: string | null;
  receipt?: Record<string, unknown> | null;
};

function formatShopifyAmount(amount: number) {
  return amount.toFixed(2);
}

function isBankTransferTransaction(
  transaction: ShopifyOrderTransaction,
  bankTransactionId: string
) {
  return (
    transaction.authorization === bankTransactionId ||
    transaction.receipt?.bank_transaction_id === bankTransactionId
  );
}

export async function markOrderPaidByBankTransfer(input: {
  shopDomain?: string | null;
  orderId: string;
  amount: number;
  currency: string;
  bankTransactionId: string;
}) {
  const transactions = await shopifyRest<{ transactions: ShopifyOrderTransaction[] }>(
    input.shopDomain,
    `orders/${input.orderId}/transactions.json`
  );
  const existing = transactions.transactions.find((transaction) =>
    isBankTransferTransaction(transaction, input.bankTransactionId)
  );
  if (existing) {
    return { transaction: existing, created: false };
  }

  const created = await shopifyRest<{ transaction: ShopifyOrderTransaction }>(
    input.shopDomain,
    `orders/${input.orderId}/transactions.json`,
    {
      method: "POST",
      body: JSON.stringify({
        transaction: {
          kind: "sale",
          status: "success",
          amount: formatShopifyAmount(input.amount),
          currency: input.currency,
          gateway: "PrivatBank bank transfer",
          source_name: "external",
          authorization: input.bankTransactionId,
        },
      }),
    }
  );

  return { transaction: created.transaction, created: true };
}
