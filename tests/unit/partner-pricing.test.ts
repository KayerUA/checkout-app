import { describe, expect, it } from "vitest";
import {
  bestPartnerDiscountPct,
  isPartnerProgramDiscountCode,
  parsePartnerDiscountRules,
  partnerCartSnapshotUnitPrice,
  partnerEmailForPricing,
  partnerUnitPriceFromCatalog,
} from "@/lib/checkout/partner-pricing";

describe("partner pricing rules", () => {
  const rules = parsePartnerDiscountRules(
    '[{"collection_handle":"luxio","pct":35},{"collection_handle":"gel-brushes","pct":25},{"collection_handle":"sculpturing-gel","pct":30}]'
  );

  it("picks the best matching collection discount", () => {
    expect(bestPartnerDiscountPct(rules, ["gel-brushes", "other"])).toBe(25);
    expect(bestPartnerDiscountPct(rules, ["luxio-base", "luxio"])).toBe(35);
  });

  it("supports B2B Pro all-products rules without collection_handle", () => {
    const allRules = parsePartnerDiscountRules(
      '[{"all":true,"pct":19.0,"label":"B2B Pro · all products"}]'
    );
    expect(allRules).toEqual([
      { collection_handle: "*", pct: 19, all: true, label: "B2B Pro · all products" },
    ]);
    expect(bestPartnerDiscountPct(allRules, ["luxio", "gel-brushes"])).toBe(19);
    expect(partnerUnitPriceFromCatalog(114_500, allRules, ["luxio"])).toBe(
      Math.round(114_500 * 0.81)
    );
  });

  it("applies luxio promo collection fallback", () => {
    expect(bestPartnerDiscountPct(rules, ["akcja-luxio-kolory-2026-06"])).toBe(35);
  });

  it("computes partner unit price from Admin retail catalog", () => {
    expect(partnerUnitPriceFromCatalog(700_000, rules, ["luxio"])).toBe(455_000);
    expect(partnerUnitPriceFromCatalog(700_000, rules, ["unknown"])).toBe(700_000);
    expect(partnerUnitPriceFromCatalog(700_000, rules, ["luxio"])).toBe(
      Math.round(700_000 * 0.65)
    );
  });

  it("KHARKIV/LVIV/LUTSK apply collection % to Admin retail (965 → 627.25)", () => {
    expect(partnerUnitPriceFromCatalog(96_500, rules, ["luxio"], "KHARKIV")).toBe(62_725);
    expect(partnerUnitPriceFromCatalog(96_500, rules, ["luxio"], "LVIV")).toBe(62_725);
    expect(partnerUnitPriceFromCatalog(96_500, rules, ["luxio"], "LUTSK")).toBe(62_725);
    expect(partnerUnitPriceFromCatalog(105_500, rules, ["sculpturing-gel"], "KHARKIV")).toBe(
      Math.round(105_500 * 0.7)
    );
    // RO still uses the same unit-price math in this helper; PARTNER code policy is separate.
    expect(partnerUnitPriceFromCatalog(96_500, rules, ["luxio"], "RO")).toBe(62_725);
  });

  it("regional cart snapshot ignores cart.js (retail or already-buy) and uses Admin+rules", () => {
    for (const market of ["KHARKIV", "LVIV", "LUTSK"]) {
      // Cart already at buy price — must NOT apply 0.65 again.
      expect(
        partnerCartSnapshotUnitPrice({
          market,
          finalUnitPriceCents: 62_725,
          originalUnitPriceCents: 62_725,
          catalogUnitPriceCents: 96_500,
          rules,
          collectionHandles: ["luxio"],
        })
      ).toBe(62_725);

      // Cart still at retail — still lands on buy.
      expect(
        partnerCartSnapshotUnitPrice({
          market,
          finalUnitPriceCents: 96_500,
          originalUnitPriceCents: 96_500,
          catalogUnitPriceCents: 96_500,
          rules,
          collectionHandles: ["luxio"],
        })
      ).toBe(62_725);

      // Stale double-discounted cart total must not win.
      expect(
        partnerCartSnapshotUnitPrice({
          market,
          finalUnitPriceCents: 40_771,
          originalUnitPriceCents: 62_725,
          catalogUnitPriceCents: 96_500,
          rules,
          collectionHandles: ["luxio"],
        })
      ).toBe(62_725);
    }
  });

  it("non-regional cart snapshot still prefers cart final price", () => {
    expect(
      partnerCartSnapshotUnitPrice({
        market: "RO",
        finalUnitPriceCents: 40_771,
        originalUnitPriceCents: 62_725,
      })
    ).toBe(40_771);
  });

  it("detects PARTNER program codes", () => {
    expect(isPartnerProgramDiscountCode("PARTNER-24109539885380")).toBe(true);
    expect(isPartnerProgramDiscountCode("KAYERUA5")).toBe(false);
  });

  it("keeps logged-in partner email for pricing when checkout email differs", () => {
    expect(
      partnerEmailForPricing({
        verifiedPartnerEmail: "partner@salon.ua",
        buyerEmail: "buhgalter@company.ua",
      })
    ).toBe("partner@salon.ua");
  });
});
