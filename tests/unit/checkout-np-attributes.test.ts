import { describe, expect, it } from "vitest";
import {
  buildShopifyNovaPoshtaNoteAttributes,
  mergeCheckoutNoteAttributes,
} from "@/lib/shipping/shopify-np-note-attributes";
import { mapCheckoutToOrderCreateInput } from "@/lib/shopify/order-mapper";

describe("Nova Poshta note attributes", () => {
  it("builds Chekly-compatible delivery refs", () => {
    const rows = buildShopifyNovaPoshtaNoteAttributes({
      cityRef: "city-ref-1",
      cityName: "Київ",
      branchRef: "wh-ref-1",
      branchName: "Київ, Пирогівський шлях, 135",
      branchNumber: "135",
      branchType: "branch",
      postalCode: "01001",
    });

    const map = Object.fromEntries(rows.map((row) => [row.name, row.value]));
    expect(map["_delivery_city_Ref"]).toBe("city-ref-1");
    expect(map["_delivery_warehouse_Ref"]).toBe("wh-ref-1");
    expect(map["_delivery_warehouse_Number"]).toBe("135");
    expect(map["_delivery_warehouse_zip"]).toBe("01001");
    expect(map["Delivery Method"]).toBe("Нова пошта");
  });

  it("merges NP attrs without dropping checkout fields", () => {
    const merged = mergeCheckoutNoteAttributes(
      [
        { name: "checkout_session_id", value: "sess-1" },
        { name: "payment_provider", value: "LIQPAY" },
      ],
      {
        cityRef: "city-ref-1",
        cityName: "Київ",
        branchRef: "wh-ref-1",
        branchName: "Київ, Богатирська, 11",
        branchNumber: "11",
      }
    );

    expect(merged.find((row) => row.name === "checkout_session_id")?.value).toBe("sess-1");
    expect(merged.find((row) => row.name === "_delivery_warehouse_Ref")?.value).toBe("wh-ref-1");
  });

  it("includes NP attrs in Shopify orderCreate customAttributes", () => {
    const order = mapCheckoutToOrderCreateInput(
      {
        id: "session-1",
        merchantId: "merchant-1",
        publicToken: "token-1",
        status: "READY",
        sourceIdentifier: "chk_1",
        currency: "UAH",
        subtotal: 10000,
        shippingAmount: 0,
        discountAmount: 0,
        totalAmount: 10000,
        buyerEmail: "buyer@example.com",
        buyerPhone: "+380501111111",
        buyerFirstName: "Test",
        buyerLastName: "Buyer",
        shippingMethodCode: "nova_poshta_branch",
        shippingProvider: "nova_poshta",
        shippingPayload: {
          cityRef: "city-ref-1",
          cityName: "Київ",
          branchRef: "wh-ref-1",
          branchName: "Київ, Богатирська, 11",
          branchNumber: "11",
          postalCode: "01001",
        },
        billingPayload: null,
        paymentProvider: "LIQPAY",
        customAttributes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        abandonedAt: null,
        lines: [
          {
            id: "line-1",
            checkoutSessionId: "session-1",
            variantGid: "gid://shopify/ProductVariant/1",
            productGid: null,
            sku: "SKU1",
            title: "Product",
            quantity: 1,
            unitPrice: 10000,
            compareAtPrice: null,
            lineDiscountAmount: 0,
            metadata: null,
          },
        ],
        paymentAttempts: [
          {
            id: "pay-1",
            checkoutSessionId: "session-1",
            provider: "LIQPAY",
            amount: 19000,
            providerReference: "ref-1",
            status: "PAID",
            requestPayload: {},
            callbackPayload: null,
            verifiedAt: new Date(),
            modifiedAtProvider: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      {
        id: "pay-1",
        checkoutSessionId: "session-1",
        provider: "LIQPAY",
        amount: 19000,
        providerReference: "ref-1",
        status: "PAID",
        requestPayload: {},
        callbackPayload: null,
        verifiedAt: new Date(),
        modifiedAtProvider: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { includeShippingLines: true }
    );

    const attrs = Object.fromEntries(
      order.customAttributes.map((row) => [row.key, row.value])
    );
    expect(attrs["_delivery_warehouse_Ref"]).toBe("wh-ref-1");
    expect(attrs["_delivery_city_Ref"]).toBe("city-ref-1");
    expect(attrs["_delivery_warehouse_zip"]).toBe("01001");
    expect(order.shippingAddress.zip).toBe("01001");
    expect(order.shippingAddress.phone).toBe("+380501111111");
    expect(order.shippingLines).toEqual([
      {
        title: "Нова Пошта",
        priceSet: { shopMoney: { amount: 0, currencyCode: "UAH" } },
      },
    ]);
  });
});
