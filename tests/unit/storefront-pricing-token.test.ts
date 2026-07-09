import { describe, expect, it } from "vitest";
import {
  signStorefrontPricingToken,
  verifyStorefrontPricingToken,
} from "@/lib/checkout/storefront-pricing-token";
import {
  cartTotalMatchesExpected,
  computeCartLevelDiscountCents,
} from "@/lib/checkout/cart-pricing";

describe("storefront pricing token", () => {
  it("signs and verifies a logged-in customer token", () => {
    process.env.SESSION_SECRET = "x".repeat(32);
    const token = signStorefrontPricingToken({
      shop: "kayer.myshopify.com",
      customerGid: "gid://shopify/Customer/1",
      email: "partner@salon.ua",
      ttlSec: 120,
    });
    const payload = verifyStorefrontPricingToken(token, "kayer.myshopify.com");
    expect(payload?.customerGid).toBe("gid://shopify/Customer/1");
    expect(payload?.email).toBe("partner@salon.ua");
  });

  it("rejects tokens for another shop", () => {
    process.env.SESSION_SECRET = "x".repeat(32);
    const token = signStorefrontPricingToken({
      shop: "kayer.myshopify.com",
      customerGid: "gid://shopify/Customer/1",
      email: "partner@salon.ua",
    });
    expect(verifyStorefrontPricingToken(token, "other.myshopify.com")).toBeNull();
  });
});

describe("retail cart-level discount", () => {
  it("computes newsletter / promo remainder", () => {
    expect(computeCartLevelDiscountCents(10_000, 9_500)).toBe(500);
    expect(cartTotalMatchesExpected(10_000, 500, 9_500)).toBe(true);
  });
});
