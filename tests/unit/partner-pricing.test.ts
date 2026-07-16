import { describe, expect, it } from "vitest";
import {
  bestPartnerDiscountPct,
  parsePartnerDiscountRules,
  partnerCartSnapshotUnitPrice,
  partnerEmailForPricing,
  partnerUnitPriceFromCatalog,
} from "@/lib/checkout/partner-pricing";

describe("partner pricing rules", () => {
  const rules = parsePartnerDiscountRules(
    '[{"collection_handle":"luxio","pct":35},{"collection_handle":"gel-brushes","pct":25}]'
  );

  it("picks the best matching collection discount", () => {
    expect(bestPartnerDiscountPct(rules, ["gel-brushes", "other"])).toBe(25);
    expect(bestPartnerDiscountPct(rules, ["luxio-base", "luxio"])).toBe(35);
  });

  it("applies luxio promo collection fallback", () => {
    expect(bestPartnerDiscountPct(rules, ["akcja-luxio-kolory-2026-06"])).toBe(35);
  });

  it("computes partner unit price from catalog", () => {
    expect(partnerUnitPriceFromCatalog(700_000, rules, ["luxio"])).toBe(455_000);
    expect(partnerUnitPriceFromCatalog(700_000, rules, ["unknown"])).toBe(700_000);
    expect(partnerUnitPriceFromCatalog(700_000, rules, ["luxio"])).toBe(
      Math.round(700_000 * 0.65)
    );
  });

  it("keeps UA regional distributor market catalog price without extra checkout %", () => {
    expect(partnerUnitPriceFromCatalog(513_500, rules, ["luxio"], "KHARKIV")).toBe(513_500);
    expect(partnerUnitPriceFromCatalog(513_500, rules, ["luxio"], "LVIV")).toBe(513_500);
    expect(partnerUnitPriceFromCatalog(513_500, rules, ["luxio"], "LUTSK")).toBe(513_500);
    expect(partnerUnitPriceFromCatalog(513_500, rules, ["luxio"], "RO")).toBe(333_775);
  });

  it("restores the contextual catalog price from stale UA partner carts", () => {
    const staleDiscountedPrice = 40_771;
    const contextualCatalogPrice = 62_725;
    for (const market of ["KHARKIV", "LVIV", "LUTSK"]) {
      expect(
        partnerCartSnapshotUnitPrice({
          market,
          finalUnitPriceCents: staleDiscountedPrice,
          originalUnitPriceCents: contextualCatalogPrice,
        })
      ).toBe(contextualCatalogPrice);
    }
    expect(
      partnerCartSnapshotUnitPrice({
        market: "RO",
        finalUnitPriceCents: staleDiscountedPrice,
        originalUnitPriceCents: contextualCatalogPrice,
      })
    ).toBe(staleDiscountedPrice);
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
