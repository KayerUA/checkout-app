import { getEnv } from "@/lib/env";

const VARIANT_INVOICE_NAMES_QUERY = `
  query VariantInvoiceNames($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        sku
        metafield(namespace: "kayer_dilovod", key: "invoice_name") {
          value
        }
      }
    }
  }
`;

const VARIANT_INVOICE_NAMES_BY_SKU_QUERY = `
  query VariantInvoiceNamesBySku($query: String!) {
    productVariants(first: 1, query: $query) {
      nodes {
        id
        sku
        metafield(namespace: "kayer_dilovod", key: "invoice_name") {
          value
        }
      }
    }
  }
`;

type VariantInvoiceNode = {
  id: string;
  sku: string | null;
  metafield: { value: string } | null;
};

function getShopDomain(shopDomain?: string | null) {
  const env = getEnv();
  const domain = shopDomain || env.SHOPIFY_SHOP_DOMAIN;
  if (!domain) throw new Error("SHOPIFY_SHOP_DOMAIN is required");
  return domain;
}

function getAccessToken() {
  const token = getEnv().SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) return null;
  return token;
}

async function shopifyAdminGraphQL<T>(
  shopDomain: string | null | undefined,
  query: string,
  variables: Record<string, unknown>
): Promise<T | null> {
  const token = getAccessToken();
  if (!token) return null;
  const env = getEnv();
  const domain = getShopDomain(shopDomain);
  const response = await fetch(`https://${domain}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

function normalizeVariantGid(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("gid://shopify/ProductVariant/")) return value;
  if (/^\d+$/.test(value)) return `gid://shopify/ProductVariant/${value}`;
  return value;
}

export async function fetchVariantDilovodInvoiceNames(
  shopDomain: string | null | undefined,
  variantGids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(variantGids.map((gid) => normalizeVariantGid(gid ?? "")).filter(Boolean))
  );
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const chunkSize = 50;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const response = await shopifyAdminGraphQL<{
      data?: { nodes?: Array<VariantInvoiceNode | null> };
    }>(shopDomain, VARIANT_INVOICE_NAMES_QUERY, { ids: chunk });
    for (const node of response?.data?.nodes ?? []) {
      const name = node?.metafield?.value?.trim();
      if (node?.id && name) out.set(node.id, name);
    }
  }
  return out;
}

export async function fetchDilovodInvoiceNamesBySku(
  shopDomain: string | null | undefined,
  skus: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(skus.map((sku) => (sku ?? "").trim()).filter(Boolean)));
  for (const sku of unique) {
    const response = await shopifyAdminGraphQL<{
      data?: { productVariants?: { nodes?: VariantInvoiceNode[] } };
    }>(shopDomain, VARIANT_INVOICE_NAMES_BY_SKU_QUERY, { query: `sku:${sku}` });
    const node = response?.data?.productVariants?.nodes?.[0];
    const name = node?.metafield?.value?.trim();
    if (name) out.set(sku, name);
  }
  return out;
}

export function resolveLineInvoiceTitle(input: {
  storefrontTitle: string;
  variantGid?: string | null;
  metadata?: unknown;
  dilovodNamesByVariantGid?: Map<string, string>;
  dilovodNamesBySku?: Map<string, string>;
  sku?: string | null;
}): string {
  const gid = normalizeVariantGid(input.variantGid ?? "");
  const fromGid = gid ? input.dilovodNamesByVariantGid?.get(gid)?.trim() : "";
  if (fromGid) return fromGid;

  const sku = (input.sku ?? "").trim();
  const fromSku = sku ? input.dilovodNamesBySku?.get(sku)?.trim() : "";
  if (fromSku) return fromSku;

  const metadata = (input.metadata ?? {}) as { dilovodInvoiceName?: string | null };
  const fromMetadata = metadata.dilovodInvoiceName?.trim();
  if (fromMetadata) return fromMetadata;

  return input.storefrontTitle;
}
