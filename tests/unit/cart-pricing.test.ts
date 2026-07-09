import { describe, expect, it } from "vitest";
import { applyCartUnitPriceHint } from "@/lib/checkout/cart-pricing";

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
    expect(result.lineDiscountAmount).toBe(0);
  });

  it("ignores cart hint above catalog", () => {
    const result = applyCartUnitPriceHint({
      catalogUnitPriceCents: 500_000,
      quantity: 1,
      unitPriceCents: 600_000,
    });
    expect(result.unitPrice).toBe(500_000);
  });

  it("ignores suspiciously low cart hint", () => {
    const result = applyCartUnitPriceHint({
      catalogUnitPriceCents: 700_000,
      quantity: 1,
      unitPriceCents: 100_000,
    });
    expect(result.unitPrice).toBe(700_000);
  });
});
