import { describe, expect, it } from "vitest";
import {
  getCheckoutLineInvoiceTitle,
  resolveInvoiceLineTitle,
} from "@/lib/checkout/line-display";

describe("checkout line display", () => {
  it("prefers dilovod invoice name from metadata", () => {
    expect(
      getCheckoutLineInvoiceTitle({
        title: "Luxio — Red",
        metadata: { dilovodInvoiceName: "LUXIO гель кольоровий №095 DELICATE 15 мл" },
      })
    ).toBe("LUXIO гель кольоровий №095 DELICATE 15 мл");
  });

  it("falls back to storefront title when metafield missing", () => {
    expect(
      getCheckoutLineInvoiceTitle({
        title: "Luxio — Red",
        metadata: { productHandle: "luxio-red" },
      })
    ).toBe("Luxio — Red");
  });

  it("resolves invoice line title from explicit dilovod field", () => {
    expect(
      resolveInvoiceLineTitle({
        title: "Shopify title",
        dilovodInvoiceName: "Dilovod title",
      })
    ).toBe("Dilovod title");
  });
});
