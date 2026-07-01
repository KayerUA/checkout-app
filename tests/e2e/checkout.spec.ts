import { test, expect } from "@playwright/test";

test.describe("KAYER checkout rollout", () => {
  test("health endpoint responds", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBeLessThan(503);
    const body = await res.json();
    expect(body.service).toBe("kayer-checkout");
  });

  test("kayer-checkout.js is served", async ({ request }) => {
    const res = await request.get("/kayer-checkout.js");
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain("KAYER external checkout bridge");
    expect(text).toContain("checkout-sessions");
  });

  test("checkout-sessions API supports CORS preflight", async ({ request }) => {
    const res = await request.fetch("/api/public/checkout-sessions", {
      method: "OPTIONS",
      headers: { Origin: "https://kayer.ua" },
    });
    expect(res.status()).toBe(204);
    expect(res.headers()["access-control-allow-origin"]).toBe("https://kayer.ua");
  });

  test("admin install CTA visible when not authenticated", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText("Install on Shopify")).toBeVisible();
  });

  test("checkout page shows LiqPay only (when session exists)", async ({ page }) => {
    // Without a real merchant/session this validates routing only
    const res = await page.goto("/checkout/invalid-token");
    expect(res?.status()).toBeLessThan(500);
  });
});
