import { describe, it, expect } from "vitest";
import { verifyLiqPayCallback, parseLiqPayData } from "@/lib/payments/types";
import crypto from "node:crypto";
import { calcTotals, formatMoney } from "@/lib/checkout/pricing";
import { invoiceGoodsAmount } from "@/lib/documents/invoice";
import { mapCheckoutToOrderCreateInput } from "@/lib/shopify/order-mapper";
import { buildPaymentDescription } from "@/lib/payments/service";

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

describe("Payment description", () => {
  it("includes checkout order number for LiqPay comments", () => {
    expect(
      buildPaymentDescription({
        sourceIdentifier: "chk_test_123",
        publicToken: "public-token",
      })
    ).toBe("Оплата замовлення № chk_test_123 — KAYER");
  });
});

describe("Idempotency transitions", () => {
  it("allows DRAFT to READY", async () => {
    const { canTransition } = await import("@/lib/checkout/state-machine");
    expect(canTransition("DRAFT", "READY")).toBe(true);
    expect(canTransition("PAID", "DRAFT")).toBe(false);
  });
});

describe("B2B invoice checkout", () => {
  it("calculates invoice amount from goods only", () => {
    expect(
      invoiceGoodsAmount({
        id: "1",
        total_price: "1290.00",
        line_items: [
          { title: "A", quantity: 2, price: "450.00" },
          { title: "B", quantity: 1, price_set: { shop_money: { amount: "300.00" } } },
        ],
      })
    ).toBe(1200);
  });

  it("can omit shipping lines for bank invoice Shopify orders", () => {
    const order = mapCheckoutToOrderCreateInput(
      {
        id: "session-1",
        merchantId: "merchant-1",
        publicToken: "token-1",
        status: "READY",
        sourceIdentifier: "chk_1",
        currency: "UAH",
        subtotal: 10000,
        shippingAmount: 9000,
        discountAmount: 0,
        totalAmount: 10000,
        buyerEmail: "docs@example.com",
        buyerPhone: "+380501111111",
        buyerFirstName: "Test",
        buyerLastName: "Buyer",
        shippingMethodCode: "nova_poshta_branch",
        shippingProvider: "nova_poshta",
        shippingPayload: { branchRef: "np-1", branchName: "Відділення 1", cityName: "Київ" },
        billingPayload: null,
        paymentProvider: null,
        customAttributes: {
          buyer_type: "fop_company",
          payment_preference: "bank_invoice",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        abandonedAt: null,
        lines: [
          {
            id: "line-1",
            checkoutSessionId: "session-1",
            variantGid: "gid://shopify/ProductVariant/1",
            productGid: null,
            sku: null,
            title: "Product",
            quantity: 1,
            unitPrice: 10000,
            compareAtPrice: null,
            lineDiscountAmount: 0,
            metadata: null,
          },
        ],
        paymentAttempts: [],
      },
      null,
      { financialStatus: "PENDING", includeShippingLines: false }
    );

    expect(order.shippingLines).toEqual([]);
  });
});

describe("Shopify order mapping", () => {
  it("does not charge Nova Poshta delivery as a Shopify shipping line by default", () => {
    const order = mapCheckoutToOrderCreateInput(
      {
        id: "session-ship-1",
        merchantId: "merchant-1",
        publicToken: "token-ship-1",
        status: "READY",
        sourceIdentifier: "chk_ship_1",
        currency: "UAH",
        subtotal: 10000,
        shippingAmount: 9000,
        discountAmount: 0,
        totalAmount: 19000,
        buyerEmail: "buyer@example.com",
        buyerPhone: "+380501111111",
        buyerFirstName: "Test",
        buyerLastName: "Buyer",
        shippingMethodCode: "nova_poshta_branch",
        shippingProvider: "nova_poshta",
        shippingPayload: { branchRef: "np-1", branchName: "Відділення 1", cityName: "Київ" },
        billingPayload: null,
        paymentProvider: null,
        customAttributes: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        abandonedAt: null,
        lines: [
          {
            id: "line-ship-1",
            checkoutSessionId: "session-ship-1",
            variantGid: "gid://shopify/ProductVariant/1",
            productGid: null,
            sku: null,
            title: "Product",
            quantity: 1,
            unitPrice: 10000,
            compareAtPrice: null,
            lineDiscountAmount: 0,
            metadata: null,
          },
        ],
        paymentAttempts: [],
      },
      null
    );

    expect(order.shippingLines).toEqual([]);
  });
});
