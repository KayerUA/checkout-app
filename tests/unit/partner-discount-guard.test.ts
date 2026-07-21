import { describe, expect, it } from "vitest";
import { CheckoutDiscountError } from "@/lib/checkout/discount-code";
import { isPartnerProgramDiscountCode } from "@/lib/checkout/partner-pricing";

/**
 * Mirrors createCheckoutSession PARTNER policy without spinning up Prisma.
 * Valid partner context → strip. No context → hard fail (never treat as B2C promo).
 */
function resolvePartnerDiscountCodeInput(input: {
  partnerContext: { market?: string } | null;
  requestedDiscountCode: string;
}): string {
  const code = input.requestedDiscountCode;
  if (input.partnerContext && isPartnerProgramDiscountCode(code)) {
    return "";
  }
  if (!input.partnerContext && isPartnerProgramDiscountCode(code)) {
    throw new CheckoutDiscountError(
      "Партнерську знижку не підтверджено. Увійдіть у акаунт партнера і спробуйте знову."
    );
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

  it("rejects unverified PARTNER instead of treating it as a B2C promo", () => {
    expect(() =>
      resolvePartnerDiscountCodeInput({
        partnerContext: null,
        requestedDiscountCode: "PARTNER-24109539885380",
      })
    ).toThrow(CheckoutDiscountError);
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
