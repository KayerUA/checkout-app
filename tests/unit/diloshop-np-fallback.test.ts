import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: {
    DILOSHOP_NP_WEBHOOK_URL:
      "https://diloshop.example/webhook/nova-poshta" as string | undefined,
    DILOSHOP_NP_FLOW_SECRET: "flow-secret" as string | undefined,
    DILOSHOP_WEBHOOK_SECRET: undefined as string | undefined,
    SHOPIFY_WEBHOOK_SECRET: undefined as string | undefined,
    SHOPIFY_API_SECRET: "shopify-secret",
    SHOPIFY_SHOP_DOMAIN: "kayer.myshopify.com",
  },
  create: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  writeAutomationLog: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => state.env,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    idempotencyKey: {
      create: state.create,
      findUnique: state.findUnique,
      updateMany: state.updateMany,
      update: state.update,
    },
  },
}));

vi.mock("@/lib/b2b/log", () => ({
  writeAutomationLog: state.writeAutomationLog,
}));

import {
  isDiloshopNovaPoshtaFallbackConfigured,
  notifyDiloshopNovaPoshtaFallback,
} from "@/lib/shipping/diloshop-np-fallback";

const order = {
  id: 123,
  name: "#1001",
  financial_status: "paid",
  note_attributes: [{ name: "checkout_session_id", value: "session-1" }],
};

describe("Diloshop Nova Poshta fallback", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    state.env.DILOSHOP_NP_WEBHOOK_URL = "https://diloshop.example/webhook/nova-poshta";
    state.env.DILOSHOP_NP_FLOW_SECRET = "flow-secret";
    state.env.DILOSHOP_WEBHOOK_SECRET = undefined;
    state.env.SHOPIFY_WEBHOOK_SECRET = undefined;
    state.env.SHOPIFY_API_SECRET = "shopify-secret";
    state.create.mockResolvedValue({ id: "claim-1" });
    state.findUnique.mockResolvedValue(null);
    state.updateMany.mockResolvedValue({ count: 1 });
    state.update.mockResolvedValue({ id: "claim-1" });
    state.writeAutomationLog.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts the paid Shopify order with the flow secret and deterministic webhook id", async () => {
    const result = await notifyDiloshopNovaPoshtaFallback({
      order,
      shopDomain: "kayer.myshopify.com",
      checkoutSessionId: "session-1",
    });

    expect(result).toEqual({
      ok: true,
      webhookId: "kayer-checkout-np-123:session-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://diloshop.example/webhook/nova-poshta");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(order));
    expect(init.headers).toMatchObject({
      "X-Flow-Secret": "flow-secret",
      "X-Shopify-Topic": "orders/paid",
      "X-Shopify-Shop-Domain": "kayer.myshopify.com",
      "X-Shopify-Webhook-Id": "kayer-checkout-np-123:session-1",
    });
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responseSnapshot: {
            status: "SENT",
            webhookId: "kayer-checkout-np-123:session-1",
          },
        }),
      })
    );
  });

  it("uses Shopify HMAC when the dedicated flow secret is absent", async () => {
    state.env.DILOSHOP_NP_FLOW_SECRET = undefined;
    const rawBody = JSON.stringify(order);
    const expectedHmac = crypto
      .createHmac("sha256", "shopify-secret")
      .update(rawBody, "utf8")
      .digest("base64");

    await notifyDiloshopNovaPoshtaFallback({
      order,
      checkoutSessionId: "session-1",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "X-Shopify-Hmac-Sha256": expectedHmac,
    });
    expect(init.headers).not.toHaveProperty("X-Flow-Secret");
  });

  it("does not send the fallback twice after a successful dispatch", async () => {
    state.create.mockRejectedValue(new Error("unique constraint"));
    state.findUnique.mockResolvedValue({
      id: "claim-1",
      responseSnapshot: { status: "SENT" },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await notifyDiloshopNovaPoshtaFallback({
      order,
      checkoutSessionId: "session-1",
    });

    expect(result).toMatchObject({ skipped: true, reason: "already_dispatched" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the local claim when Diloshop rejects the delivery", async () => {
    fetchMock.mockResolvedValue(new Response("temporary failure", { status: 503 }));

    await expect(
      notifyDiloshopNovaPoshtaFallback({
        order,
        checkoutSessionId: "session-1",
      })
    ).rejects.toThrow("Diloshop Nova Poshta webhook failed: 503 temporary failure");

    expect(state.updateMany).toHaveBeenCalledWith({
      where: { scope: "diloshop-np-fallback", key: "123:session-1" },
      data: {
        responseSnapshot: { status: "FAILED" },
        expiresAt: new Date(0),
      },
    });
  });

  it("stays disabled without DILOSHOP_NP_WEBHOOK_URL", async () => {
    state.env.DILOSHOP_NP_WEBHOOK_URL = undefined;

    expect(isDiloshopNovaPoshtaFallbackConfigured()).toBe(false);
    await expect(
      notifyDiloshopNovaPoshtaFallback({ order, checkoutSessionId: "session-1" })
    ).resolves.toEqual({ skipped: true, reason: "missing_url" });
    expect(state.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
