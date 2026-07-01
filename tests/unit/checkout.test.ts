import { describe, it, expect } from "vitest";
import { verifyLiqPayCallback, parseLiqPayData } from "@/lib/payments/types";
import crypto from "node:crypto";
import { calcTotals, formatMoney } from "@/lib/checkout/pricing";

describe("LiqPay verification", () => {
  it("verifies valid signature", () => {
    const privateKey = "test_private_key";
    const data = Buffer.from(JSON.stringify({ order_id: "123", status: "success" })).toString("base64");
    const signature = crypto
      .createHash("sha1")
      .update(privateKey + data + privateKey)
      .digest("base64");
    expect(verifyLiqPayCallback(data, signature, privateKey)).toBe(true);
  });

  it("parses data", () => {
    const payload = { order_id: "abc", amount: 100 };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64");
    expect(parseLiqPayData(data)).toEqual(payload);
  });
});

describe("Pricing", () => {
  it("calculates totals in kopiyky", () => {
    const lines = [
      { id: "1", checkoutSessionId: "s", variantGid: "", title: "", quantity: 2, unitPrice: 10000, compareAtPrice: null, lineDiscountAmount: 0, metadata: null, sku: null, productGid: null },
    ];
    const totals = calcTotals(lines, 9000, 0);
    expect(totals.subtotal).toBe(20000);
    expect(totals.totalAmount).toBe(29000);
  });

  it("formats UAH consistently for SSR and client", () => {
    expect(formatMoney(45000)).toBe("450,00 грн");
    expect(formatMoney(189000)).toBe("1 890,00 грн");
    expect(formatMoney(0)).toBe("0,00 грн");
  });
});

describe("Idempotency transitions", () => {
  it("allows DRAFT to READY", async () => {
    const { canTransition } = await import("@/lib/checkout/state-machine");
    expect(canTransition("DRAFT", "READY")).toBe(true);
    expect(canTransition("PAID", "DRAFT")).toBe(false);
  });
});
