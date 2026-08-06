import { describe, expect, it } from "vitest";
import {
  canUseNovaPoshtaPostomat,
  NOVA_POSHTA_POSTOMAT_MAX_COST_CENTS,
} from "@/lib/shipping/nova-poshta-postomat-policy";

describe("Nova Poshta postomat policy", () => {
  it("blocks regular customers above the provider limit", () => {
    expect(
      canUseNovaPoshtaPostomat({
        totalAmountCents: NOVA_POSHTA_POSTOMAT_MAX_COST_CENTS + 1,
        shopifyCustomerGid: "gid://shopify/Customer/1",
      })
    ).toBe(false);
  });

  it("allows the explicit verified customer override", () => {
    expect(
      canUseNovaPoshtaPostomat({
        totalAmountCents: 3_472_000,
        shopifyCustomerGid: "gid://shopify/Customer/24109539885380",
      })
    ).toBe(true);
  });
});
