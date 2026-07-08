import { describe, expect, it } from "vitest";
import { resolveLineInvoiceTitle } from "@/lib/shopify/variant-invoice-names";
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

  it("prefers admin-token dilovod name by sku", () => {
    expect(
      resolveLineInvoiceTitle({
        storefrontTitle: "Luxio Base — Default Title",
        sku: "LUX-GEL-001",
        dilovodNamesBySku: new Map([["LUX-GEL-001", "гель для нігтів -грунтівка LUXIO Base BASE"]]),
      })
    ).toBe("гель для нігтів -грунтівка LUXIO Base BASE");
  });
});
