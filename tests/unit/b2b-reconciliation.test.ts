import { describe, expect, it } from "vitest";
import { extractInvoiceNumber, matchBankTransaction } from "@/lib/reconciliation/matcher";
import type { BankTransaction } from "@/lib/bank/types";

const baseTx: BankTransaction = {
  provider: "mock",
  transaction_id: "tx_1",
  transaction_date: new Date("2026-07-01T10:00:00Z"),
  payer_name: "ФОП Іваненко Іван",
  amount: 1200,
  currency: "UAH",
  payment_description: "Оплата за рахунком KAYER-UA-2026-000123 від 01.07.2026",
  raw_payload: {},
};

const candidates = [
  {
    shopifyOrderId: "1234",
    shopifyOrderName: "#60037",
    invoiceNumber: "KAYER-UA-2026-000123",
    fopName: "Іваненко Іван",
    amount: 1200,
    currency: "UAH",
  },
];

describe("B2B bank reconciliation matcher", () => {
  it("extracts invoice number from payment description", () => {
    expect(extractInvoiceNumber(baseTx.payment_description)).toBe("KAYER-UA-2026-000123");
  });

  it("matches by invoice number and exact amount", () => {
    const match = matchBankTransaction(baseTx, candidates);
    expect(match.status).toBe("MATCHED");
    expect(match.confidence).toBe(1);
    expect(match.candidate?.shopifyOrderId).toBe("1234");
  });

  it("requires review when invoice exists but amount differs", () => {
    const match = matchBankTransaction({ ...baseTx, amount: 1000 }, candidates);
    expect(match.status).toBe("NEEDS_REVIEW");
    expect(match.reason).toBe("amount_mismatch");
  });

  it("soft matches by amount and payer name without invoice number", () => {
    const match = matchBankTransaction(
      { ...baseTx, payment_description: "Оплата товарів" },
      candidates
    );
    expect(match.status).toBe("NEEDS_REVIEW");
    expect(match.confidence).toBe(0.75);
  });

  it("matches by Shopify order number and exact amount", () => {
    const match = matchBankTransaction(
      { ...baseTx, payment_description: "Оплата замовлення № 60037" },
      candidates
    );
    expect(match.status).toBe("MATCHED");
    expect(match.confidence).toBe(0.98);
  });
});
