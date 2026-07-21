import { describe, expect, it } from "vitest";
import { checkoutSessionPatchSchema } from "@/lib/checkout/public-input";

describe("checkout phone schema", () => {
  it("normalizes Ukrainian checkout numbers to E.164", () => {
    expect(checkoutSessionPatchSchema.parse({ buyerPhone: "067 123 45 67" }).buyerPhone)
      .toBe("+380671234567");
  });

  it("rejects incomplete and non-Ukrainian customer phones", () => {
    expect(checkoutSessionPatchSchema.safeParse({ buyerPhone: "+38098002777" }).success).toBe(false);
    expect(checkoutSessionPatchSchema.safeParse({ buyerPhone: "+48123123123" }).success).toBe(false);
  });
});
