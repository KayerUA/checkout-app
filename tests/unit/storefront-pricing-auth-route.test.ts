import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/apps/kayer-checkout-auth/route";

describe("storefront pricing auth App Proxy route", () => {
  it("rejects a request without a valid Shopify App Proxy signature", async () => {
    const response = await GET(
      new NextRequest("https://checkout.kayer.ua/apps/kayer-checkout-auth")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid app proxy signature",
    });
  });
});
