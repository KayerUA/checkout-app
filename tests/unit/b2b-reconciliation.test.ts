import { describe, expect, it } from "vitest";
import {
  extractInvoiceNumber,
  extractOrderNumberHints,
  matchBankTransaction,
  parseShopifyOrderName,
} from "@/lib/reconciliation/matcher";
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

const ua1155Candidates = [
  {
    shopifyOrderId: "10993912217924",
    shopifyOrderName: "#UA1155",
    invoiceNumber: "KAYER-UA-2026-000200",
    fopName: "Карапата Тетяна",
    amount: 7722,
    currency: "UAH",
  },
];

describe("B2B bank reconciliation matcher", () => {
  it("extracts invoice number from payment description", () => {
    expect(extractInvoiceNumber(baseTx.payment_description)).toBe("KAYER-UA-2026-000123");
  });

  it("parses UA shopify order names", () => {
    expect(parseShopifyOrderName("#UA1155")).toEqual({ full: "UA1155", numeric: 1155 });
  });

  it("extracts numeric order hint from рахунок 1155", () => {
    expect(extractOrderNumberHints("Оплата за рахунок 1155 без ПДВ")).toEqual([
      { full: "UA1155", numeric: 1155 },
    ]);
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
    expect(match.reason).toBe("invoice_number_exact_amount_amount_mismatch");
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
    expect(match.confidence).toBe(0.97);
    expect(match.reason).toBe("order_number_hint");
  });

  it("extracts numeric order hint from Russian счет 1155", () => {
    expect(extractOrderNumberHints("Оплата по счету 1155")).toEqual([{ full: "UA1155", numeric: 1155 }]);
  });

  it("matches #UA1155 when payment says only 1155 after рахунок", () => {
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 7722,
        payment_description: "Оплата за рахунок 1155, без ПДВ",
        payer_name: "ФОП Карапата Тетяна",
      },
      ua1155Candidates
    );
    expect(match.status).toBe("MATCHED");
    expect(match.reason).toBe("order_number_hint");
    expect(match.candidate?.shopifyOrderName).toBe("#UA1155");
  });

  it("extracts order number from №1155 without keywords", () => {
    expect(extractOrderNumberHints("some text №1155 more")).toEqual([{ full: "UA1155", numeric: 1155 }]);
  });

  it("matches single open candidate by amount and numeric order number in description", () => {
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 7722,
        payment_description: "broken encoding text 1155",
      },
      ua1155Candidates
    );
    expect(match.status).toBe("MATCHED");
    expect(match.reason).toBe("single_open_candidate_amount_and_order_number");
  });

  it("matches #UA1155 from invoice purpose згідно рахунку №1155", () => {
    const description = "оплата за замовлення згідно рахунку №1155 від 09 липня 2026 р.";
    expect(extractOrderNumberHints(description)).toEqual([{ full: "UA1155", numeric: 1155 }]);
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 7722,
        payment_description: description,
        payer_name: "ФОП Карапата Тетяна",
      },
      ua1155Candidates
    );
    expect(match.status).toBe("MATCHED");
    expect(match.reason).toBe("order_number_hint");
    expect(match.candidate?.shopifyOrderName).toBe("#UA1155");
  });

  it("matches #UA1155 when payment says UA1155 explicitly", () => {
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 7722,
        payment_description: "Оплата замовлення UA1155",
      },
      ua1155Candidates
    );
    expect(match.status).toBe("MATCHED");
    expect(match.candidate?.shopifyOrderId).toBe("10993912217924");
  });
});
