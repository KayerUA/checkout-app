import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMerchantShopifySession, fetchPartnerPricingContextByGid } = vi.hoisted(() => ({
  getMerchantShopifySession: vi.fn(),
  fetchPartnerPricingContextByGid: vi.fn(),
}));

vi.mock("@/lib/shopify/session-store", () => ({
  getMerchantShopifySession,
}));

vi.mock("@/lib/checkout/partner-pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkout/partner-pricing")>();
  return {
    ...actual,
    fetchPartnerPricingContextByGid,
  };
});

import { resolveVerifiedPartnerContextForMerchant } from "@/lib/checkout/session-service";

describe("verified partner pricing identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMerchantShopifySession.mockResolvedValue({
      shop: "9drztb-0x.myshopify.com",
      accessToken: "test",
    });
  });

  it("does not resolve partner pricing from a raw email or customer ID alone", async () => {
    await expect(
      resolveVerifiedPartnerContextForMerchant({
        merchantId: "merchant-1",
        storefrontCustomerEmail: "partner@salon.ua",
      })
    ).resolves.toBeNull();
    await expect(
      resolveVerifiedPartnerContextForMerchant({
        merchantId: "merchant-1",
        storefrontCustomerId: "123",
      })
    ).resolves.toBeNull();
    expect(fetchPartnerPricingContextByGid).not.toHaveBeenCalled();
  });

  it("requires the storefront email to match the customer ID", async () => {
    fetchPartnerPricingContextByGid.mockResolvedValue({
      customerGid: "gid://shopify/Customer/123",
      email: "another@salon.ua",
      market: "LVIV",
      rules: [],
    });

    await expect(
      resolveVerifiedPartnerContextForMerchant({
        merchantId: "merchant-1",
        storefrontCustomerEmail: "partner@salon.ua",
        storefrontCustomerId: "123",
      })
    ).resolves.toBeNull();
  });

  it("resolves a matching storefront customer ID and email", async () => {
    const partner = {
      customerGid: "gid://shopify/Customer/123",
      email: "partner@salon.ua",
      market: "LVIV",
      rules: [],
    };
    fetchPartnerPricingContextByGid.mockResolvedValue(partner);

    await expect(
      resolveVerifiedPartnerContextForMerchant({
        merchantId: "merchant-1",
        storefrontCustomerEmail: "PARTNER@salon.ua",
        storefrontCustomerId: "123",
      })
    ).resolves.toEqual(partner);
  });

  it("resolves a previously verified customer GID", async () => {
    const partner = {
      customerGid: "gid://shopify/Customer/123",
      email: "partner@salon.ua",
      market: "LVIV",
      rules: [],
    };
    fetchPartnerPricingContextByGid.mockResolvedValue(partner);

    await expect(
      resolveVerifiedPartnerContextForMerchant({
        merchantId: "merchant-1",
        verifiedPartnerGid: partner.customerGid,
      })
    ).resolves.toEqual(partner);
    expect(fetchPartnerPricingContextByGid).toHaveBeenCalledWith(
      expect.objectContaining({ shop: "9drztb-0x.myshopify.com" }),
      partner.customerGid
    );
  });
});
