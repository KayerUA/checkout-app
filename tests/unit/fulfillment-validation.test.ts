import { describe, expect, it } from "vitest";
import { checkoutFulfillmentIssues } from "@/lib/checkout/fulfillment-validation";

const valid = {
  buyerEmail: "buyer@example.com",
  buyerPhone: "+380671234567",
  buyerFirstName: "Ірина",
  buyerLastName: "Коваль",
  shippingProvider: "nova_poshta",
  shippingMethodCode: "nova_poshta_branch",
  shippingPayload: {
    cityRef: "city-1",
    cityName: "Київ",
    branchRef: "branch-1",
    branchName: "Відділення №1",
    postalCode: "01001",
  },
};

describe("checkout fulfillment validation", () => {
  it("accepts a complete Nova Poshta recipient", () => {
    expect(checkoutFulfillmentIssues(valid)).toEqual([]);
  });

  it("reports every missing prerequisite before payment or NP dispatch", () => {
    expect(checkoutFulfillmentIssues({ ...valid, buyerPhone: "+38098002777", buyerFirstName: "12", shippingPayload: {} }))
      .toEqual(expect.arrayContaining([
        "український номер +380XXXXXXXXX",
        "ім’я отримувача кирилицею",
        "місто Нова Пошта",
        "відділення або поштомат Нова Пошта",
        "п’ятизначний індекс відділення Нова Пошта",
      ]));
  });
});
