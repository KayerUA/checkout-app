import { describe, expect, it } from "vitest";
import { buildSavingsSummary } from "@/lib/checkout/savings-summary";

describe("buildSavingsSummary", () => {
  it("uses cart snapshot rows when totals match", () => {
    const summary = buildSavingsSummary(
      {
        subtotal: 85000,
        discountAmount: 5000,
        totalAmount: 80000,
        lines: [
          {
            quantity: 1,
            unitPrice: 85000,
            compareAtPrice: 100000,
            metadata: { catalogUnitPriceCents: 100000 },
          },
        ],
      },
      {
        pricingMode: "shopify_cart",
        cartDiscountSnapshot: {
          grossSubtotalCents: 100000,
          discountRows: [
            { title: "Літній сейл −15%", amountCents: 10000 },
            { title: "Промокод −5%", amountCents: 5000 },
          ],
          totalDueCents: 80000,
        },
      }
    );

    expect(summary).not.toBeNull();
    expect(summary?.discountRows).toHaveLength(2);
    expect(summary?.totalSavingsCents).toBe(20000);
    expect(summary?.totalDueCents).toBe(80000);
  });

  it("falls back to server rows when snapshot is missing", () => {
    const summary = buildSavingsSummary(
      {
        subtotal: 90000,
        discountAmount: 0,
        totalAmount: 90000,
        lines: [
          {
            quantity: 2,
            unitPrice: 45000,
            compareAtPrice: 50000,
            metadata: { catalogUnitPriceCents: 50000 },
          },
        ],
      },
      { pricingMode: "shopify_cart" }
    );

    expect(summary).not.toBeNull();
    expect(summary?.grossSubtotalCents).toBe(100000);
    expect(summary?.discountRows[0]?.title).toBe("Знижки на товари");
    expect(summary?.totalSavingsCents).toBe(10000);
  });

  it("returns null when there are no savings", () => {
    const summary = buildSavingsSummary(
      {
        subtotal: 50000,
        discountAmount: 0,
        totalAmount: 50000,
        lines: [{ quantity: 1, unitPrice: 50000, compareAtPrice: null, metadata: {} }],
      },
      { pricingMode: "shopify_cart" }
    );

    expect(summary).toBeNull();
  });
});
