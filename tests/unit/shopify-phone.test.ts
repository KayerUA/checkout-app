import { describe, expect, it } from "vitest";
import { normalizePhoneForShopify, normalizeUaPhone } from "@/lib/checkout/phone";

describe("normalizePhoneForShopify", () => {
  it("converts common Ukrainian local formats to E.164", () => {
    expect(normalizePhoneForShopify("067 123 45 67")).toBe("+380671234567");
    expect(normalizePhoneForShopify("+380 (67) 123-45-67")).toBe("+380671234567");
    expect(normalizePhoneForShopify("00380 67 123 45 67")).toBe("+380671234567");
    expect(normalizeUaPhone("380671234567")).toBe("+380671234567");
  });

  it("omits invalid checkout input instead of submitting it to Shopify", () => {
    expect(normalizePhoneForShopify("abc")).toBeUndefined();
    expect(normalizePhoneForShopify("123")).toBeUndefined();
    expect(normalizePhoneForShopify("+38098002777")).toBeUndefined();
    expect(normalizeUaPhone("+48123123123")).toBeUndefined();
    expect(normalizePhoneForShopify(null)).toBeUndefined();
  });
});
