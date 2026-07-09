import { describe, expect, it } from "vitest";
import { applyCartUnitPriceHint, cartSubtotalMatchesHint } from "@/lib/checkout/cart-pricing";

describe("applyCartUnitPriceHint", () => {
  it("uses discounted cart unit price for partner -35%", () => {
    const result = applyCartUnitPriceHint({
      catalogUnitPriceCents: 700_000,
      quantity: 1,
      unitPriceCents: 455_000,
      originalUnitPriceCents: 700_000,
    });
    expect(result.unitPrice).toBe(455_000);
    expect(result.compareAtPrice).toBe(700_000);
    expect(result.usedCartHint).toBe(true);
  });

  it("allows deep discounts like -65% when cart original matches catalog", () => {
    const result = applyCartUnitPriceHint({
      catalogUnitPriceCents: 700_000,
      quantity: 1,
      unitPriceCents: 245_000,
      originalUnitPriceCents: 700_000,
    });
    expect(result.unitPrice).toBe(245_000);
    expect(result.usedCartHint).toBe(true);
  });

  it("ignores cart hint above catalog", () => {
    const result = applyCartUnitPriceHint({
      catalogUnitPriceCents: 500_000,
      quantity: 1,
      unitPriceCents: 600_000,
      originalUnitPriceCents: 500_000,
    });
    expect(result.unitPrice).toBe(500_000);
    expect(result.usedCartHint).toBe(false);
  });

  it("ignores hint when original price does not match catalog", () => {
    const result = applyCartUnitPriceHint({
      catalogUnitPriceCents: 700_000,
      quantity: 1,
      unitPriceCents: 100_000,
      originalUnitPriceCents: 400_000,
    });
    expect(result.unitPrice).toBe(700_000);
    expect(result.usedCartHint).toBe(false);
  });
});

describe("cartSubtotalMatchesHint", () => {
  it("accepts matching cart subtotal", () => {
    expect(
      cartSubtotalMatchesHint(
        [{ unitPrice: 455_000, quantity: 2, lineDiscountAmount: 0 }],
        910_000
      )
    ).toBe(true);
  });

  it("rejects manipulated subtotal", () => {
    expect(
      cartSubtotalMatchesHint(
        [{ unitPrice: 100_000, quantity: 1, lineDiscountAmount: 0 }],
        455_000
      )
    ).toBe(false);
  });
});
