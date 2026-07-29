import { describe, expect, it } from "vitest";
import {
  invoiceDiscountedLines,
  invoiceGoodsAmount,
} from "@/lib/documents/invoice";

describe("B2B invoice discounts", () => {
  it("folds a Shopify order-level promo into invoice rows", () => {
    const order = {
      id: "1",
      total_price: "726.75",
      total_line_items_price: "765.00",
      total_discounts: "38.25",
      line_items: [
        {
          sku: "GP603",
          title: "Gel Play Perfect French White",
          quantity: 1,
          price: "765.00",
        },
      ],
    };

    const lines = invoiceDiscountedLines(order);

    expect(lines[0].price).toBe("726.750000");
    expect(invoiceGoodsAmount({ ...order, line_items: lines })).toBe(726.75);
  });

  it("allocates a cart discount proportionally and preserves the exact cent total", () => {
    const order = {
      id: "2",
      total_price: "24.98",
      total_line_items_price: "30.00",
      total_discounts: "5.02",
      line_items: [
        { title: "A", quantity: 3, price: "3.33" },
        { title: "B", quantity: 2, price: "10.005" },
      ],
    };

    const lines = invoiceDiscountedLines(order);

    expect(invoiceGoodsAmount({ ...order, line_items: lines })).toBeCloseTo(24.98, 8);
  });

  it("keeps undiscounted goods totals independent from shipping", () => {
    const order = {
      id: "3",
      total_price: "1290.00",
      total_line_items_price: "1200.00",
      total_discounts: "0.00",
      line_items: [
        { title: "A", quantity: 2, price: "450.00" },
        { title: "B", quantity: 1, price: "300.00" },
      ],
    };

    const lines = invoiceDiscountedLines(order);

    expect(invoiceGoodsAmount({ ...order, line_items: lines })).toBe(1200);
  });
});
