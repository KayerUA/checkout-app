import { getShopify } from "@/lib/shopify/client";
import { getEnv } from "@/lib/env";
import type { Session } from "@shopify/shopify-api";

export async function shopifyAdminGraphQL<T = unknown>(
  session: Session,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const shopify = getShopify();
  const client = new shopify.clients.Graphql({ session });
  const response = await client.request(query, { variables });
  return response as T;
}

export async function shopifyAdminREST(
  session: Session,
  path: string,
  options: { method?: string; body?: unknown } = {}
) {
  const apiVersion = getEnv().SHOPIFY_API_VERSION;
  const url = `https://${session.shop}/admin/api/${apiVersion}/${path}`;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken ?? "",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Shopify REST error: ${await res.text()}`);
  }
  return res.json();
}
