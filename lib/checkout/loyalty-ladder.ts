import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";

/**
 * ORDER-class automatic discounts in Shopify — the BRUTTO loyalty ladder.
 *
 * The storefront cart already applies the ladder, so a checkout without a promo code
 * just inherits it via cartTotalCents. A promo code is a PRODUCT-class discount, and
 * Shopify re-evaluates the ORDER-class tier on the subtotal *after* product discounts,
 * which can move the buyer down a tier (8800 → 15%, but 8474.50 after −5% → 10%).
 * That re-evaluation needs the thresholds, so we read them from Shopify instead of
 * hardcoding them here.
 */

const ORDER_LOYALTY_LADDER_QUERY = `
  query OrderLoyaltyLadder {
    automaticDiscountNodes(first: 50) {
      nodes {
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBasic {
            title
            status
            discountClasses
            customerGets {
              value {
                __typename
                ... on DiscountPercentage {
                  percentage
                }
              }
            }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }
`;

export type LoyaltyTier = {
  title: string;
  /** Whole percent, e.g. 10 for −10%. */
  percentage: number;
  minimumSubtotalCents: number;
};

export type LoyaltyLadderResponse = {
  data?: {
    automaticDiscountNodes?: {
      nodes?: Array<{
        automaticDiscount?: {
          __typename?: string;
          title?: string;
          status?: string;
          discountClasses?: string[];
          customerGets?: { value?: { __typename?: string; percentage?: number } };
          minimumRequirement?: {
            __typename?: string;
            greaterThanOrEqualToSubtotal?: { amount: string };
          };
        } | null;
      }>;
    };
  };
};

export function parseOrderLoyaltyLadder(payload: LoyaltyLadderResponse): LoyaltyTier[] {
  const nodes = payload.data?.automaticDiscountNodes?.nodes ?? [];
  const tiers: LoyaltyTier[] = [];

  for (const node of nodes) {
    const discount = node?.automaticDiscount;
    if (!discount || discount.__typename !== "DiscountAutomaticBasic") continue;
    if (discount.status !== "ACTIVE") continue;
    if (!(discount.discountClasses ?? []).includes("ORDER")) continue;

    const value = discount.customerGets?.value;
    if (value?.__typename !== "DiscountPercentage" || typeof value.percentage !== "number") continue;

    const minimum = discount.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount;
    tiers.push({
      title: String(discount.title ?? "").trim() || "Програма лояльності",
      // Shopify returns a ratio: 0.1 means 10%.
      percentage: value.percentage * 100,
      minimumSubtotalCents: minimum ? Math.round(parseFloat(minimum) * 100) : 0,
    });
  }

  return tiers.sort((a, b) => a.minimumSubtotalCents - b.minimumSubtotalCents);
}

/** Tiers never stack with each other, so the buyer gets the single best one they reach. */
export function pickLoyaltyTier(tiers: LoyaltyTier[], subtotalCents: number): LoyaltyTier | null {
  return tiers
    .filter((tier) => subtotalCents >= tier.minimumSubtotalCents && tier.percentage > 0)
    .reduce<LoyaltyTier | null>(
      (best, tier) => (!best || tier.percentage > best.percentage ? tier : best),
      null
    );
}

export function computeLoyaltyDiscount(
  tiers: LoyaltyTier[],
  subtotalCents: number
): { tier: LoyaltyTier | null; discountCents: number } {
  const tier = pickLoyaltyTier(tiers, subtotalCents);
  if (!tier) return { tier: null, discountCents: 0 };
  return {
    tier,
    discountCents: Math.max(0, Math.round((subtotalCents * tier.percentage) / 100)),
  };
}

const LADDER_CACHE_TTL_MS = 5 * 60_000;
const ladderCache = new Map<string, { fetchedAt: number; tiers: LoyaltyTier[] }>();

export function clearLoyaltyLadderCache() {
  ladderCache.clear();
}

export async function fetchOrderLoyaltyLadder(merchantId: string): Promise<LoyaltyTier[]> {
  const cached = ladderCache.get(merchantId);
  if (cached && Date.now() - cached.fetchedAt < LADDER_CACHE_TTL_MS) return cached.tiers;

  const session = await getMerchantShopifySession(merchantId);
  if (!session) throw new Error("Merchant Shopify session not found");

  const result = await shopifyAdminGraphQL<LoyaltyLadderResponse>(
    session,
    ORDER_LOYALTY_LADDER_QUERY
  );
  const tiers = parseOrderLoyaltyLadder(result);
  ladderCache.set(merchantId, { fetchedAt: Date.now(), tiers });
  return tiers;
}
