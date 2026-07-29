import { describe, expect, it, vi } from "vitest";
import { isPrismaUniqueConstraintError } from "@/lib/documents/b2b-document";
import { createInvoicePdf } from "@/lib/documents/invoice-pdf";
import type { B2BDocumentInput } from "@/lib/b2b/types";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({}),
}));

function invoiceInput(lineCount: number): B2BDocumentInput {
  return {
    shopifyOrderId: "11029025194308",
    shopifyOrderName: "#UA1230",
    invoiceNumber: "KAYER-UA-2026-000230",
    invoiceDate: new Date("2026-07-27T12:00:00Z"),
    buyer: {
      buyer_type: "fop_company",
      payment_preference: "bank_invoice",
      fop_name: "ФОП Карапата Тетяна Анатоліївна",
      fop_tax_id: "3394002806",
      docs_email: "buyer@example.com",
      docs_phone: "+380501234567",
    },
    amount: 17074.5,
    currency: "UAH",
    lines: Array.from({ length: lineCount }, (_, index) => ({
      sku: `SKU-${index + 1}`,
      title:
        `Дуже довга назва товарної позиції ${index + 1} з додатковими характеристиками, ` +
        "розміром, кольором та описом для бухгалтерського документа",
      quantity: 1,
      price: String(900 + index),
    })),
    paymentPurpose: "Оплата замовлення № UA1230 (або 1230), без ПДВ",
  };
}

function pdfPageCount(pdf: Buffer) {
  return pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

describe("B2B document conflicts", () => {
  it("recognizes Prisma's duplicate-record error", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2002" })).toBe(true);
  });

  it("does not mask unrelated errors", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2025" })).toBe(false);
    expect(isPrismaUniqueConstraintError(new Error("network error"))).toBe(false);
  });
});

describe("B2B invoice PDF pagination", () => {
  it("paginates a multi-line invoice without creating a page per table cell", async () => {
    const pdf = await createInvoicePdf(invoiceInput(18));

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdfPageCount(pdf)).toBeGreaterThan(1);
    expect(pdfPageCount(pdf)).toBeLessThanOrEqual(4);
  });

  it("keeps an extremely long product title inside a bounded row", async () => {
    const input = invoiceInput(1);
    input.lines[0].title = "Надзвичайно довга назва ".repeat(80);

    const pdf = await createInvoicePdf(input);

    expect(pdfPageCount(pdf)).toBe(1);
  });
});
