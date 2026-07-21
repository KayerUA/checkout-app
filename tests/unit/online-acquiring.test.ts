import { describe, expect, it } from "vitest";
import { liqPayAcquiringSourceIdentifier } from "@/lib/reconciliation/online-acquiring";

describe("LiqPay acquiring statement references", () => {
  it("maps SOID to the checkout source identifier", () => {
    expect(
      liqPayAcquiringSourceIdentifier({
        payer_tax_id: "14360570",
        payment_description:
          "LIQPAY ID 2893059357 SOID chk_cart_99f53410ef135f3fce080b05bdd16cf0_1784395288346 PBK i81079621111",
      })
    ).toBe("chk_cart_99f53410ef135f3fce080b05bdd16cf0");
  });

  it("does not classify a manual bank transfer as LiqPay acquiring", () => {
    expect(
      liqPayAcquiringSourceIdentifier({
        payer_tax_id: "2374706531",
        payment_description: "оплата за косметичний товар згідно рахунку № 70044",
      })
    ).toBeNull();
  });

  it("requires a complete SOID reference", () => {
    expect(
      liqPayAcquiringSourceIdentifier({
        payer_tax_id: "14360570",
        payment_description: "LIQPAY ID 2893059357",
      })
    ).toBeNull();
  });
});
