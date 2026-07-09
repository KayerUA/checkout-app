import { describe, expect, it } from "vitest";
import {
  bestPartnerDiscountPct,
  parsePartnerDiscountRules,
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

  it("keeps logged-in partner email for pricing when checkout email differs", () => {
    expect(
      partnerEmailForPricing({
        verifiedPartnerEmail: "partner@salon.ua",
        buyerEmail: "buhgalter@company.ua",
      })
    ).toBe("partner@salon.ua");
  });
});
