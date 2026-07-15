import { describe, expect, it } from "vitest";
import {
  allocateProportionalDiscountCents,
  mapCheckoutToOrderCreateInput,
} from "@/lib/shopify/order-mapper";

function sessionWithDiscount(appliedDiscountCode?: string) {
  return {
    id: "session-discount",
    merchantId: "merchant-1",
    publicToken: "token-discount",
    status: "PAID",
    sourceIdentifier: "chk_discount",
    currency: "UAH",
    subtotal: 15_300,
    shippingAmount: 0,
    discountAmount: 765,
    totalAmount: 14_535,
    buyerEmail: "buyer@example.com",
    buyerPhone: "+380501111111",
    buyerFirstName: "Test",
    buyerLastName: "Buyer",
    shippingMethodCode: "nova_poshta_branch",
    shippingProvider: "nova_poshta",
    shippingPayload: {
      cityName: "Київ",
      branchRef: "branch-1",
      branchName: "Відділення №1",
      postalCode: "03026",
    },
    billingPayload: null,
    paymentProvider: "LIQPAY",
    customAttributes: appliedDiscountCode ? { appliedDiscountCode } : {},
    createdAt: new Date(),
    updatedAt: new Date(),
    abandonedAt: null,
    lines: [
      {
        id: "line-1",
        checkoutSessionId: "session-discount",
        variantGid: "gid://shopify/ProductVariant/1",
        productGid: null,
        sku: "AL61",
        title: "Product",
        quantity: 2,
        unitPrice: 7_650,
        compareAtPrice: null,
        lineDiscountAmount: 0,
        metadata: null,
      },
    ],
    paymentAttempts: [],
  } as Parameters<typeof mapCheckoutToOrderCreateInput>[0];
}

describe("Shopify cart discount mapping", () => {
  it("allocates every discount cent exactly across lines", () => {
    const allocations = allocateProportionalDiscountCents([10_001, 20_002, 30_003], 3_001);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(3_001);
    expect(allocations.every((value, index) => value <= [10_001, 20_002, 30_003][index])).toBe(true);
  });

  it("creates an explicit Shopify discount code without lowering base line prices twice", () => {
    const order = mapCheckoutToOrderCreateInput(sessionWithDiscount("KAYERUA5"), null);

    expect(order.lineItems[0].priceSet.shopMoney.amount).toBe(76.5);
    expect(order.discountCode).toEqual({
      itemFixedDiscountCode: {
        code: "KAYERUA5",
        amountSet: {
          shopMoney: { amount: 7.65, currencyCode: "UAH" },
        },
      },
    });
    expect(order.customAttributes).toContainEqual({ key: "discount_code", value: "KAYERUA5" });
  });

  it("folds an anonymous cart discount into line prices with an exact total", () => {
    const order = mapCheckoutToOrderCreateInput(sessionWithDiscount(), null);
    const mappedTotalCents = Math.round(
      order.lineItems.reduce(
        (sum, line) => sum + line.priceSet.shopMoney.amount * line.quantity,
        0
      ) * 100
    );

    expect(mappedTotalCents).toBe(14_535);
    expect("discountCode" in order).toBe(false);
  });
});
