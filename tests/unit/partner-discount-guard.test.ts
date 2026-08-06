import { describe, expect, it } from "vitest";
import { isPartnerProgramDiscountCode } from "@/lib/checkout/partner-pricing";

/**
 * Mirrors createCheckoutSession PARTNER policy without spinning up Prisma.
 * Valid partner context → strip. No context → strip (never treat as B2C promo,
 * never hard-block checkout on a leftover PARTNER code).
 */
function resolvePartnerDiscountCodeInput(input: {
  partnerContext: { market?: string } | null;
  requestedDiscountCode: string;
}): string {
  const code = input.requestedDiscountCode;
  if (isPartnerProgramDiscountCode(code)) {
    return "";
  }
  return code;
}

describe("PARTNER discount guard", () => {
  it("strips PARTNER when partner context is confirmed", () => {
    expect(
      resolvePartnerDiscountCodeInput({
        partnerContext: { market: "KHARKIV" },
        requestedDiscountCode: "PARTNER-24109539885380",
      })
    ).toBe("");
  });

  it("strips unverified PARTNER instead of blocking checkout", () => {
    expect(
      resolvePartnerDiscountCodeInput({
        partnerContext: null,
        requestedDiscountCode: "PARTNER-24109539885380",
      })
    ).toBe("");
  });

  it("leaves ordinary B2C promo codes alone", () => {
    expect(
      resolvePartnerDiscountCodeInput({
        partnerContext: null,
        requestedDiscountCode: "KAYERUA5",
      })
    ).toBe("KAYERUA5");
  });
});
