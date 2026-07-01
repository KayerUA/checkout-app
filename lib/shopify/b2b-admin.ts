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

function parseTags(tags: string | string[] | null | undefined) {
  if (Array.isArray(tags)) return tags;
  return (tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function updateOrderTags(input: {
  shopDomain?: string | null;
  orderId: string;
  add?: string[];
  remove?: string[];
}) {
  const existing = await shopifyRest<{ order: { tags: string } }>(
    input.shopDomain,
    `orders/${input.orderId}.json?fields=id,tags`
  );
  const remove = new Set(input.remove ?? []);
  const next = new Set(parseTags(existing.order.tags).filter((tag) => !remove.has(tag)));
  (input.add ?? []).forEach((tag) => next.add(tag));

  await shopifyRest(input.shopDomain, `orders/${input.orderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: Number(input.orderId),
        tags: Array.from(next).join(", "),
      },
    }),
  });
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
