import { describe, expect, it, vi } from "vitest";
import {
  checkoutSessionPatchSchema,
  publicCheckoutSessionCreateSchema,
} from "@/lib/checkout/public-input";
import { assertPaymentIntegrity } from "@/lib/payments/integrity";

vi.mock("@/lib/crypto/encryption", () => ({
  encrypt: (value: string) => `encrypted(${value})`,
  decrypt: (value: string) => value.replace(/^encrypted\((.*)\)$/, "$1"),
}));

import {
  decryptPaymentConfig,
  encryptPaymentConfig,
  paymentConfigNeedsEncryption,
} from "@/lib/payments/config-secrets";

describe("public checkout input", () => {
  it("rejects system fields and partner identity in a public patch", () => {
    expect(checkoutSessionPatchSchema.safeParse({ totalAmount: 1 }).success).toBe(false);
    expect(
      checkoutSessionPatchSchema.safeParse({
        customAttributes: { partnerCustomerGid: "gid://shopify/Customer/1" },
      }).success
    ).toBe(false);
  });

  it("accepts the contact, delivery and B2B fields used by the checkout form", () => {
    expect(
      checkoutSessionPatchSchema.safeParse({
        buyerEmail: "buyer@example.com",
        buyerPhone: "+380501112233",
        buyerFirstName: "Ірина",
        buyerLastName: "Коваль",
        shippingProvider: "nova_poshta",
        shippingMethodCode: "nova_poshta_branch",
        shippingPayload: {
          cityRef: "city-1",
          cityName: "Київ",
          branchRef: "branch-1",
          branchName: "Відділення №1",
          branchNumber: "1",
          branchType: "branch",
          postalCode: "03026",
        },
        paymentProvider: "LIQPAY",
        customAttributes: {
          buyer_type: "individual",
          payment_preference: "card",
        },
        status: "READY",
      }).success
    ).toBe(true);
  });

  it("requires a real five-digit postal code when a Nova Poshta branch is selected", () => {
    const base = {
      cityRef: "city-1",
      cityName: "Київ",
      branchRef: "branch-1",
      branchName: "Відділення №1",
      branchNumber: "1",
      branchType: "branch",
    };
    expect(checkoutSessionPatchSchema.safeParse({ shippingPayload: base }).success).toBe(false);
    expect(
      checkoutSessionPatchSchema.safeParse({
        shippingPayload: { ...base, postalCode: "03026" },
      }).success
    ).toBe(true);
  });

  it("caps cart size and rejects unknown creation attributes", () => {
    const base = {
      shopDomain: "kayer.myshopify.com",
      cartLines: [{ variantGid: "gid://shopify/ProductVariant/1", quantity: 1 }],
    };
    expect(publicCheckoutSessionCreateSchema.safeParse(base).success).toBe(true);
    expect(
      publicCheckoutSessionCreateSchema.safeParse({
        ...base,
        customAttributes: { partnerCustomerGid: "gid://shopify/Customer/1" },
      }).success
    ).toBe(false);
    expect(
      publicCheckoutSessionCreateSchema.safeParse({
        ...base,
        cartLines: Array.from({ length: 101 }, (_, index) => ({
          variantGid: `gid://shopify/ProductVariant/${index}`,
          quantity: 1,
        })),
      }).success
    ).toBe(false);
  });

  it("accepts the signed partner snapshot shape and a checkout discount code", () => {
    expect(
      publicCheckoutSessionCreateSchema.safeParse({
        shopDomain: "kayer.myshopify.com",
        cartLines: [{ variantGid: "gid://shopify/ProductVariant/1", quantity: 1 }],
        customAttributes: {
          appliedDiscountCode: "KAYERUA5",
          cartDiscountSnapshot: {
            grossSubtotalCents: 100_000,
            discountRows: [{ title: "Партнерська знижка", amountCents: 35_000 }],
            totalDueCents: 65_000,
            pricingMode: "partner_rules",
          },
        },
      }).success
    ).toBe(true);
  });
});

describe("payment integrity", () => {
  it("accepts exact amount and currency", () => {
    expect(() =>
      assertPaymentIntegrity({
        expectedAmount: 45_000,
        actualAmount: 45_000,
        expectedCurrency: "UAH",
        actualCurrency: "uah",
      })
    ).not.toThrow();
  });

  it("rejects underpayment and currency mismatch", () => {
    expect(() =>
      assertPaymentIntegrity({
        expectedAmount: 45_000,
        actualAmount: 1,
        expectedCurrency: "UAH",
      })
    ).toThrow("Payment amount mismatch");
    expect(() =>
      assertPaymentIntegrity({
        expectedAmount: 45_000,
        actualAmount: 45_000,
        expectedCurrency: "UAH",
        actualCurrency: "USD",
      })
    ).toThrow("Payment currency mismatch");
  });
});

describe("payment config encryption", () => {
  it("encrypts secret fields and keeps public fields readable", () => {
    const encrypted = encryptPaymentConfig({
      publicKey: "public",
      privateKey: "private",
      token: "mono-token",
    });
    expect(encrypted).toEqual({
      publicKey: "public",
      privateKey: "enc:v1:encrypted(private)",
      token: "enc:v1:encrypted(mono-token)",
    });
    expect(paymentConfigNeedsEncryption(encrypted)).toBe(false);
    expect(decryptPaymentConfig(encrypted)).toEqual({
      publicKey: "public",
      privateKey: "private",
      token: "mono-token",
    });
  });

  it("recognizes legacy plaintext configs for migration", () => {
    expect(paymentConfigNeedsEncryption({ privateKey: "legacy" })).toBe(true);
  });
});
