import { describe, expect, it } from "vitest";
import {
  applyCartUnitPriceHint,
  cartOriginalsMatchCatalog,
  cartSubtotalMatchesHint,
  catalogPriceMatchesOriginal,
} from "@/lib/checkout/cart-pricing";

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

  it("rejects stale post-reprice hint (UA1259: old×0.85 vs new catalog)", () => {
    const result = applyCartUnitPriceHint({
      catalogUnitPriceCents: 114_500,
      quantity: 1,
      unitPriceCents: 84_575,
      originalUnitPriceCents: 99_500,
    });
    expect(result.unitPrice).toBe(114_500);
    expect(result.usedCartHint).toBe(false);
  });
});

describe("cartOriginalsMatchCatalog", () => {
  it("accepts fresh cart originals", () => {
    expect(
      cartOriginalsMatchCatalog([
        { catalogUnitPriceCents: 114_500, originalUnitPriceCents: 114_500 },
        { catalogUnitPriceCents: 108_500, originalUnitPriceCents: 108_500 },
      ])
    ).toBe(true);
  });

  it("rejects stale originals after catalog reprice", () => {
    expect(
      cartOriginalsMatchCatalog([
        { catalogUnitPriceCents: 114_500, originalUnitPriceCents: 99_500 },
      ])
    ).toBe(false);
    expect(catalogPriceMatchesOriginal(114_500, 99_500)).toBe(false);
  });

  it("rejects missing originals (unsafe for forceCartSnapshot)", () => {
    expect(cartOriginalsMatchCatalog([{ catalogUnitPriceCents: 114_500 }])).toBe(false);
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
