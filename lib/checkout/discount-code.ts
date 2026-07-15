import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";

const CODE_DISCOUNT_QUERY = `
  query CodeDiscountNodeByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          customerGets {
            value {
              __typename
              ... on DiscountPercentage {
                percentage
              }
              ... on DiscountAmount {
                amount {
                  amount
                  currencyCode
                }
                appliesOnEachItem
              }
            }
          }
          minimumRequirement {
            __typename
            ... on DiscountMinimumSubtotal {
              greaterThanOrEqualToSubtotal {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

export class CheckoutDiscountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutDiscountError";
  }
}

export type ResolvedCheckoutDiscount = {
  title: string;
  active: boolean;
  percentage?: number;
  fixedAmountCents?: number;
  appliesOnEachItem?: boolean;
  minimumSubtotalCents?: number;
};

type ShopifyDiscountResponse = {
  data?: {
    codeDiscountNodeByCode?: {
      id: string;
      codeDiscount?: {
        __typename?: string;
        title?: string;
        status?: string;
        customerGets?: {
          value?: {
            __typename?: string;
            percentage?: number;
            amount?: { amount: string; currencyCode: string };
            appliesOnEachItem?: boolean;
          };
        };
        minimumRequirement?: {
          __typename?: string;
          greaterThanOrEqualToSubtotal?: { amount: string; currencyCode: string };
        };
      };
    } | null;
  };
};

export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}

export function assertCheckoutPromoAllowed(pricingMode: string) {
  if (pricingMode === "partner_rules") {
    throw new CheckoutDiscountError("Промокоди недоступні для партнерського ціноутворення");
  }
}

export function parseShopifyDiscountNode(
  node: NonNullable<ShopifyDiscountResponse["data"]>["codeDiscountNodeByCode"]
): ResolvedCheckoutDiscount | null {
  const discount = node?.codeDiscount;
  if (!discount || discount.__typename !== "DiscountCodeBasic") return null;

  const value = discount.customerGets?.value;
  const resolved: ResolvedCheckoutDiscount = {
    title: String(discount.title ?? "Промокод").trim() || "Промокод",
    active: discount.status === "ACTIVE",
  };

  if (value?.__typename === "DiscountPercentage" && typeof value.percentage === "number") {
    // Shopify Admin returns DiscountPercentage as a ratio (0.05 means 5%).
    resolved.percentage = value.percentage * 100;
  } else if (value?.__typename === "DiscountAmount" && value.amount?.amount) {
    resolved.fixedAmountCents = Math.round(parseFloat(value.amount.amount) * 100);
    resolved.appliesOnEachItem = value.appliesOnEachItem === true;
  } else {
    return null;
  }

  const minSubtotal = discount.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount;
  if (minSubtotal) {
    resolved.minimumSubtotalCents = Math.round(parseFloat(minSubtotal) * 100);
  }

  return resolved;
}

export function computeCheckoutDiscountCents(input: {
  subtotalCents: number;
  discount: ResolvedCheckoutDiscount;
}): number {
  const { subtotalCents, discount } = input;

  if (!discount.active) {
    throw new CheckoutDiscountError("Промокод неактивний або прострочений");
  }

  if (
    typeof discount.minimumSubtotalCents === "number" &&
    subtotalCents < discount.minimumSubtotalCents
  ) {
    throw new CheckoutDiscountError("Мінімальна сума замовлення для цього промокоду не досягнута");
  }

  if (typeof discount.percentage === "number" && discount.percentage > 0) {
    return Math.max(0, Math.round((subtotalCents * discount.percentage) / 100));
  }

  if (typeof discount.fixedAmountCents === "number" && discount.fixedAmountCents > 0) {
    if (discount.appliesOnEachItem) {
      throw new CheckoutDiscountError("Цей тип промокоду поки не підтримується на checkout");
    }
    return Math.max(0, Math.min(subtotalCents, discount.fixedAmountCents));
  }

  return 0;
}

export function promoDiscountRowTitle(code: string, discountTitle?: string): string {
  const title = discountTitle?.trim();
  if (title && title.toLowerCase() !== code.toLowerCase()) return title;
  return `Промокод ${code}`;
}

export async function fetchCheckoutDiscountByCode(merchantId: string, code: string) {
  const session = await getMerchantShopifySession(merchantId);
  if (!session) throw new Error("Merchant Shopify session not found");

  const normalized = normalizeDiscountCode(code);
  const result = await shopifyAdminGraphQL<ShopifyDiscountResponse>(session, CODE_DISCOUNT_QUERY, {
    code: normalized,
  });

  const node = result.data?.codeDiscountNodeByCode;
  if (!node) {
    throw new CheckoutDiscountError("Промокод не знайдено або недійсний");
  }

  const parsed = parseShopifyDiscountNode(node);
  if (!parsed) {
    throw new CheckoutDiscountError("Цей промокод не можна застосувати на checkout");
  }

  return parsed;
}
