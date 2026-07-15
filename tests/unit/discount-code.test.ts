import { describe, expect, it } from "vitest";
import {
  CheckoutDiscountError,
  assertCheckoutPromoAllowed,
  computeCheckoutDiscountCents,
  normalizeDiscountCode,
  parseShopifyDiscountNode,
  promoDiscountRowTitle,
} from "@/lib/checkout/discount-code";
import { buildSavingsSummary } from "@/lib/checkout/savings-summary";

describe("normalizeDiscountCode", () => {
  it("trims and uppercases promo codes", () => {
    expect(normalizeDiscountCode("  kayerua5  ")).toBe("KAYERUA5");
  });
});

describe("computeCheckoutDiscountCents", () => {
  it("calculates percentage discount against subtotal", () => {
    const discount = {
      title: "Підписка −5%",
      active: true,
      percentage: 5,
    };
    expect(
      computeCheckoutDiscountCents({
        subtotalCents: 100_000,
        discount,
      })
    ).toBe(5_000);
  });

  it("rejects when minimum subtotal is not met", () => {
    const discount = {
      title: "VIP",
      active: true,
      percentage: 10,
      minimumSubtotalCents: 50_000,
    };
    expect(() =>
      computeCheckoutDiscountCents({
        subtotalCents: 30_000,
        discount,
      })
    ).toThrow(CheckoutDiscountError);
    expect(() =>
      computeCheckoutDiscountCents({
        subtotalCents: 30_000,
        discount,
      })
    ).toThrow("Мінімальна сума замовлення для цього промокоду не досягнута");
  });

  it("rejects inactive codes", () => {
    expect(() =>
      computeCheckoutDiscountCents({
        subtotalCents: 100_000,
        discount: { title: "Old", active: false, percentage: 5 },
      })
    ).toThrow("Промокод неактивний або прострочений");
  });

  it("caps fixed amount discount by subtotal", () => {
    expect(
      computeCheckoutDiscountCents({
        subtotalCents: 3_000,
        discount: { title: "Fixed", active: true, fixedAmountCents: 5_000 },
      })
    ).toBe(3_000);
  });
});

describe("parseShopifyDiscountNode", () => {
  it("parses percentage basic discount", () => {
    const parsed = parseShopifyDiscountNode({
      id: "gid://shopify/DiscountCodeNode/1",
      codeDiscount: {
        __typename: "DiscountCodeBasic",
        title: "Підписка −5%",
        status: "ACTIVE",
        customerGets: {
          value: {
            __typename: "DiscountPercentage",
            percentage: 0.05,
          },
        },
      },
    });
    expect(parsed).toEqual({
      title: "Підписка −5%",
      active: true,
      percentage: 5,
    });
  });
});

describe("promoDiscountRowTitle", () => {
  it("uses code-specific title when Shopify title matches code", () => {
    expect(promoDiscountRowTitle("KAYERUA5", "KAYERUA5")).toBe("Промокод KAYERUA5");
  });

  it("keeps Shopify title when it differs from code", () => {
    expect(promoDiscountRowTitle("KAYERUA5", "Підписка −5%")).toBe("Підписка −5%");
  });
});

describe("partner session rejection", () => {
  it("rejects promo apply for partner pricing mode", () => {
    expect(() => assertCheckoutPromoAllowed("partner_rules")).toThrow(CheckoutDiscountError);
    expect(() => assertCheckoutPromoAllowed("partner_rules")).toThrow(
      "Промокоди недоступні для партнерського ціноутворення"
    );
    expect(() => assertCheckoutPromoAllowed("shopify_cart")).not.toThrow();
  });

  it("builds savings without promo row for partner pricing mode", () => {
    const summary = buildSavingsSummary(
      {
        subtotal: 650_000,
        discountAmount: 0,
        totalAmount: 650_000,
        lines: [
          {
            quantity: 1,
            unitPrice: 650_000,
            compareAtPrice: 1_000_000,
            metadata: { catalogUnitPriceCents: 1_000_000, pricingSource: "partner_rules" },
          },
        ],
      },
      { pricingMode: "partner_rules" }
    );

    expect(summary?.pricingMode).toBe("partner_rules");
    expect(summary?.discountRows[0]?.title).toBe("Партнерська знижка");
  });
});

describe("buildSavingsSummary promo row", () => {
  it("shows promo row after manual apply snapshot", () => {
    const summary = buildSavingsSummary(
      {
        subtotal: 95_000,
        discountAmount: 5_000,
        totalAmount: 90_000,
        lines: [
          {
            quantity: 1,
            unitPrice: 95_000,
            compareAtPrice: 100_000,
            metadata: { catalogUnitPriceCents: 100_000 },
          },
        ],
      },
      {
        pricingMode: "shopify_cart",
        cartDiscountSnapshot: {
          grossSubtotalCents: 100_000,
          discountRows: [
            { title: "Знижки на товари", amountCents: 5_000 },
            { title: "Промокод KAYERUA5", amountCents: 5_000 },
          ],
          totalDueCents: 90_000,
        },
      }
    );

    expect(summary?.discountRows).toHaveLength(2);
    expect(summary?.discountRows[1]?.title).toBe("Промокод KAYERUA5");
    expect(summary?.totalSavingsCents).toBe(10_000);
  });
});
