import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/public/storefront-pricing-token/route";

describe("public storefront pricing token route", () => {
  it("does not issue a token from an unverified customer id", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Storefront pricing tokens require Shopify App Proxy authentication",
    });
  });
});
