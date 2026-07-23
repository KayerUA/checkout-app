import { describe, expect, it } from "vitest";
import {
  extractBareOrderNumberHints,
  extractInvoiceNumber,
  extractOrderNumberHints,
  findMultiOrderPaymentProposal,
  findSamePayerAmountBundle,
  matchBankTransaction,
  normalizeTaxIdentifier,
  parseShopifyOrderName,
} from "@/lib/reconciliation/matcher";
import type { BankTransaction } from "@/lib/bank/types";
import {
  invoiceAmountFromDocumentMetadata,
  mergeBankReconciliationCandidates,
} from "@/lib/reconciliation/candidates";
import {
  calculateBankPaymentProgress,
  calculateShopifyPaymentPresentation,
} from "@/lib/reconciliation/service";

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
    fopTaxId: "1234567890",
    amount: 7722,
    currency: "UAH",
  },
];

describe("B2B bank reconciliation matcher", () => {
  it("reads the authoritative amount from generated invoice metadata", () => {
    expect(
      invoiceAmountFromDocumentMetadata({
        paymentPurpose: "Оплата рахунку",
        input: { amount: 5135, currency: "UAH" },
      })
    ).toBe(5135);
    expect(invoiceAmountFromDocumentMetadata({ input: { amount: 0 } })).toBeNull();
  });

  it("prefers the invoice amount over a stale B2B order total", () => {
    const [candidate] = mergeBankReconciliationCandidates([
      {
        shopifyOrderId: "11008804684100",
        shopifyOrderName: "#UA1179",
        invoiceNumber: "KAYER-UA-2026-000028",
        amount: 3337.75,
        currency: "UAH",
        amountPriority: 1,
      },
      {
        shopifyOrderId: "11008804684100",
        shopifyOrderName: "#UA1179",
        invoiceNumber: "KAYER-UA-2026-000028",
        amount: 5135,
        currency: "UAH",
        amountPriority: 3,
      },
    ]);
    expect(candidate.amount).toBe(5135);
  });

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

  it("extracts every order from a listed bank-payment purpose", () => {
    expect(extractOrderNumberHints("Оплата за рахунки UA1213 та UA1215 без ПДВ")).toEqual([
      { full: "UA1213", numeric: 1213 },
      { full: "UA1215", numeric: 1215 },
    ]);
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

  it.each([
    "Оплата замовлення UA1155",
    "Оплата замовлення UA 1155",
    "Оплата замовлення ua-1155",
  ])("matches a different amount by exact tax id and order reference: %s", (description) => {
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 999,
        payer_tax_id: "123 456-7890",
        payment_description: description,
      },
      ua1155Candidates
    );
    expect(match.status).toBe("MATCHED");
    expect(match.reason).toBe("tax_id_and_order_number");
    expect(match.confidence).toBe(0.99);
  });

  it("matches a bare numeric order only with an exact tax id", () => {
    expect(extractBareOrderNumberHints("Товари 1155 без ПДВ")).toEqual([
      { full: "UA1155", numeric: 1155 },
    ]);
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 999,
        payer_tax_id: "1234567890",
        payment_description: "Товари 1155 без ПДВ",
      },
      ua1155Candidates
    );
    expect(match.status).toBe("MATCHED");
    expect(match.reason).toBe("tax_id_and_numeric_order_number");
  });

  it("does not auto-match a bare numeric order without the payer tax id", () => {
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 999,
        payer_tax_id: undefined,
        payment_description: "Товари 1155 без ПДВ",
      },
      ua1155Candidates
    );
    expect(match.status).toBe("NEW");
  });

  it("does not auto-match a mismatched currency even with tax id and order number", () => {
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 999,
        currency: "EUR",
        payer_tax_id: "1234567890",
        payment_description: "Оплата замовлення UA1155",
      },
      ua1155Candidates
    );
    expect(match.status).toBe("NEEDS_REVIEW");
  });

  it("does not attach an ambiguous order hint to the first matching order", () => {
    const match = matchBankTransaction(
      {
        ...baseTx,
        amount: 31355,
        payment_description: "Оплата замовлення 1215",
      },
      [
        { ...ua1155Candidates[0], shopifyOrderId: "first", shopifyOrderName: "#UA1215", amount: 11826 },
        { ...ua1155Candidates[0], shopifyOrderId: "second", shopifyOrderName: "#1215", amount: 25000 },
      ]
    );
    expect(match).toMatchObject({
      status: "NEEDS_REVIEW",
      reason: "ambiguous_order_number_hint",
      candidate: null,
    });
  });

  it("proposes multiple explicitly named orders only for the same payer tax id", () => {
    const candidatesForSplit = [
      { ...ua1155Candidates[0], shopifyOrderId: "first", shopifyOrderName: "#UA1213", amount: 19529 },
      { ...ua1155Candidates[0], shopifyOrderId: "second", shopifyOrderName: "#UA1215", amount: 11826 },
    ];
    const tx = {
      ...baseTx,
      amount: 31355,
      payer_tax_id: "1234567890",
      payment_description: "Оплата за замовлення UA1213 та UA1215",
    };
    expect(findMultiOrderPaymentProposal(tx, candidatesForSplit)).toMatchObject({
      expectedAmount: 31355,
      amountDifference: 0,
      candidates: [{ shopifyOrderName: "#UA1213" }, { shopifyOrderName: "#UA1215" }],
    });
    expect(
      findMultiOrderPaymentProposal(
        tx,
        [{ ...candidatesForSplit[0], fopTaxId: "9999999999" }, candidatesForSplit[1]]
      )
    ).toBeNull();
  });

  it("proposes one unique same-payer invoice bundle when bank order refs are missing", () => {
    const bundle = findSamePayerAmountBundle(
      { ...baseTx, amount: 31355, payer_tax_id: "1234567890", payment_description: "Оплата товару" },
      [
        { ...ua1155Candidates[0], shopifyOrderId: "first", shopifyOrderName: "#UA1213", amount: 19529.75 },
        { ...ua1155Candidates[0], shopifyOrderId: "second", shopifyOrderName: "#UA1215", amount: 11826 },
      ]
    );
    expect(bundle).toMatchObject({
      expectedAmount: 31355.75,
      amountDifference: -0.75,
      candidates: [{ shopifyOrderName: "#UA1213" }, { shopifyOrderName: "#UA1215" }],
    });
  });

  it("normalizes punctuation in tax identifiers", () => {
    expect(normalizeTaxIdentifier(" UA-12 34/56 ")).toBe("UA123456");
  });

  it.each([
    [1000, 999, "PARTIALLY_PAID", 1, 0],
    [1000, 1000, "PAID", 0, 0],
    [1000, 1001, "PAID_WITH_OVERPAYMENT", 0, 1],
  ] as const)(
    "calculates cumulative payment progress %s/%s as %s",
    (expected, paid, status, remaining, overpayment) => {
      expect(calculateBankPaymentProgress(expected, paid)).toMatchObject({
        status,
        expectedAmount: expected,
        paidAmount: paid,
        remainingAmount: remaining,
        overpaymentAmount: overpayment,
        isFullyPaid: paid >= expected,
      });
    }
  );

  it("presents a bank amount above the Shopify transaction as an overpayment", () => {
    expect(
      calculateShopifyPaymentPresentation({
        paidAmount: 6272.5,
        businessOverpaymentAmount: 0,
        shopifyRecordedAmount: 4077.12,
      })
    ).toEqual({
      status: "PAID_WITH_OVERPAYMENT",
      shopifyRecordedAmount: 4077.12,
      bankVsShopifyDifferenceAmount: 2195.38,
      overpaymentAmount: 2195.38,
    });
  });

  it("keeps an exact bank and Shopify payment as paid", () => {
    expect(
      calculateShopifyPaymentPresentation({
        paidAmount: 1000,
        businessOverpaymentAmount: 0,
        shopifyRecordedAmount: 1000,
      })
    ).toMatchObject({ status: "PAID", overpaymentAmount: 0 });
  });
});
