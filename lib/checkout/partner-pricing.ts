import type { Session } from "@shopify/shopify-api";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";

export type PartnerDiscountRule = {
  collection_handle: string;
  pct: number;
  label?: string;
};

export type PartnerPricingContext = {
  customerGid: string;
  email: string;
  market?: string;
  rules: PartnerDiscountRule[];
};

export const UA_REGIONAL_DISTRIBUTOR_MARKETS = new Set(["LVIV", "LUTSK", "KHARKIV"]);

export function isUaRegionalDistributorMarket(market?: string | null): boolean {
  return UA_REGIONAL_DISTRIBUTOR_MARKETS.has((market ?? "").trim().toUpperCase());
}

/** UA regional distributors pay contextual market catalog prices — no extra % at checkout. */
export function partnerMarketUsesCatalogCheckoutPrice(market?: string | null): boolean {
  return isUaRegionalDistributorMarket(market);
}

export function isPartnerProgramDiscountCode(code?: string | null): boolean {
  return /^PARTNER-/i.test(String(code ?? "").trim());
}

export function partnerCartSnapshotUnitPrice(input: {
  market?: string | null;
  finalUnitPriceCents?: number | null;
  originalUnitPriceCents?: number | null;
}): number {
  const finalPrice = Math.max(0, Math.round(input.finalUnitPriceCents ?? 0));
  const originalPrice = Math.max(0, Math.round(input.originalUnitPriceCents ?? 0));
  if (partnerMarketUsesCatalogCheckoutPrice(input.market) && originalPrice > 0) {
    return originalPrice;
  }
  return finalPrice || originalPrice;
}

const LUXIO_COLOUR_PROMO_HANDLE = "akcja-luxio-kolory-2026-06";

const CUSTOMER_PARTNER_QUERY = `
  query PartnerCustomerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          email
          tags
          metafields(first: 30, namespace: "partner") {
            nodes { key value }
          }
        }
      }
    }
  }
`;

const CUSTOMER_PARTNER_BY_GID_QUERY = `
  query PartnerCustomerByGid($id: ID!) {
    customer(id: $id) {
      id
      email
      tags
      metafields(first: 30, namespace: "partner") {
        nodes { key value }
      }
    }
  }
`;

export function normalizeCheckoutEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function parsePartnerDiscountRules(raw: unknown): PartnerDiscountRule[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const rules: PartnerDiscountRule[] = [];
  for (const rule of parsed) {
    if (!rule || typeof rule !== "object") continue;
    const handle = String((rule as PartnerDiscountRule).collection_handle ?? "").trim();
    const pct = Number((rule as PartnerDiscountRule).pct);
    if (!handle || !Number.isFinite(pct) || pct <= 0) continue;
    const entry: PartnerDiscountRule = { collection_handle: handle, pct };
    if (typeof (rule as PartnerDiscountRule).label === "string") {
      entry.label = (rule as PartnerDiscountRule).label;
    }
    rules.push(entry);
  }
  return rules;
}

/** Mirrors theme_ua partner-preview-mode.js bestDiscountPct(). */
export function bestPartnerDiscountPct(
  rules: PartnerDiscountRule[],
  collectionHandles: string[]
): number {
  const handles = new Set(collectionHandles);
  let best = 0;
  for (const rule of rules) {
    if (handles.has(rule.collection_handle) && rule.pct > best) {
      best = rule.pct;
    }
  }
  if (best <= 0 && handles.has(LUXIO_COLOUR_PROMO_HANDLE)) {
    for (const rule of rules) {
      if (rule.collection_handle === "luxio" && rule.pct > best) {
        best = rule.pct;
      }
    }
  }
  return best;
}

export function partnerUnitPriceFromCatalog(
  catalogCents: number,
  rules: PartnerDiscountRule[],
  collectionHandles: string[],
  market?: string | null
): number {
  const catalog = Math.max(0, Math.round(catalogCents));
  if (partnerMarketUsesCatalogCheckoutPrice(market)) return catalog;
  const pct = bestPartnerDiscountPct(rules, collectionHandles);
  if (pct <= 0) return catalog;
  return Math.max(0, Math.round(catalog * (1 - pct / 100)));
}

function partnerMetafieldMap(
  nodes: Array<{ key: string; value: string }> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const node of nodes ?? []) {
    const key = String(node.key ?? "").trim();
    if (key) out[key] = String(node.value ?? "");
  }
  return out;
}

function isActivePartnerCustomer(tags: string[], metafields: Record<string, string>): boolean {
  const tagSet = new Set(tags.map((tag) => tag.trim().toLowerCase()));
  if (!tagSet.has("partner_active")) return false;
  const status = (metafields.program_status ?? "active").trim().toLowerCase();
  return status === "active";
}

function buildPartnerContextFromCustomer(
  customer: {
    id: string;
    email: string;
    tags: string[];
    metafields?: { nodes?: Array<{ key: string; value: string }> };
  },
  fallbackEmail?: string
): PartnerPricingContext | null {
  const metafields = partnerMetafieldMap(customer.metafields?.nodes);
  if (!isActivePartnerCustomer(customer.tags ?? [], metafields)) return null;

  const rules = parsePartnerDiscountRules(metafields.discount_rules_json);
  if (!rules.length) return null;

  return {
    customerGid: customer.id,
    email: normalizeCheckoutEmail(customer.email) || normalizeCheckoutEmail(fallbackEmail),
    market: (metafields.market || metafields.distributor_country || "").trim().toUpperCase() || undefined,
    rules,
  };
}

export async function fetchPartnerPricingContextByGid(
  session: Session,
  customerGid: string
): Promise<PartnerPricingContext | null> {
  const result = await shopifyAdminGraphQL<{
    data?: {
      customer?: {
        id: string;
        email: string;
        tags: string[];
        metafields?: { nodes?: Array<{ key: string; value: string }> };
      } | null;
    };
  }>(session, CUSTOMER_PARTNER_BY_GID_QUERY, { id: customerGid });

  const customer = result.data?.customer;
  if (!customer?.id) return null;
  return buildPartnerContextFromCustomer(customer);
}

export async function fetchPartnerPricingContext(
  session: Session,
  email: string
): Promise<PartnerPricingContext | null> {
  const normalized = normalizeCheckoutEmail(email);
  if (!normalized) return null;

  const result = await shopifyAdminGraphQL<{
    data?: {
      customers?: {
        edges?: Array<{
          node?: {
            id: string;
            email: string;
            tags: string[];
            metafields?: { nodes?: Array<{ key: string; value: string }> };
          };
        }>;
      };
    };
  }>(session, CUSTOMER_PARTNER_QUERY, { query: `email:${normalized}` });

  const customer = result.data?.customers?.edges?.[0]?.node;
  if (!customer?.id) return null;

  return buildPartnerContextFromCustomer(customer, normalized);
}

/** Email used to resolve partner discount rules (checkout contact email may differ). */
export function partnerEmailForPricing(input: {
  verifiedPartnerEmail?: string | null;
  buyerEmail?: string | null;
}): string | null {
  const verified = normalizeCheckoutEmail(input.verifiedPartnerEmail);
  if (verified) return verified;
  const buyer = normalizeCheckoutEmail(input.buyerEmail);
  return buyer || null;
}
