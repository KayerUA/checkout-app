import type { BankStatementProvider, BankTransaction } from "@/lib/bank/types";

type PrivatBankProviderOptions = {
  apiUrl?: string;
  token?: string;
  iban?: string;
};

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const data = payload as Record<string, unknown>;
  for (const key of ["transactions", "statements", "items", "data", "rows"]) {
    const value = data[key];
    if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  }
  return [];
}

export class PrivatBankStatementProvider implements BankStatementProvider {
  constructor(private options: PrivatBankProviderOptions) {}

  async fetchTransactions(from: Date, to: Date): Promise<BankTransaction[]> {
    if (!this.options.apiUrl || !this.options.token) {
      throw new Error("PrivatBank provider requires BANK_API_URL and BANK_API_TOKEN");
    }

    const url = new URL(this.options.apiUrl);
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", to.toISOString());
    if (this.options.iban) url.searchParams.set("iban", this.options.iban);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`PrivatBank statement fetch failed: ${await response.text()}`);
    }

    const payload = await response.json();
    return extractRows(payload).map((record, index) => {
      const transactionId =
        firstString(record, ["transaction_id", "transactionId", "id", "ref", "reference", "doc_id"]) ||
        `privatbank_${firstString(record, ["date", "transaction_date", "postDate"])}_${index}`;

      return {
        provider: "privatbank",
        transaction_id: transactionId,
        transaction_date: new Date(
          firstString(record, ["transaction_date", "transactionDate", "date", "postDate", "created_at"])
        ),
        payer_name: firstString(record, ["payer_name", "payerName", "contragentName", "sender_name", "name"]),
        payer_tax_id: firstString(record, ["payer_tax_id", "payerTaxId", "contragentCode", "sender_tax_id"]),
        amount: firstNumber(record, ["amount", "sum", "credit", "amountCredit"]),
        currency: firstString(record, ["currency", "ccy", "currencyCode"]) || "UAH",
        payment_description: firstString(record, ["payment_description", "description", "purpose", "paymentPurpose", "details"]),
        iban_from: firstString(record, ["iban_from", "ibanFrom", "sender_iban", "account_from"]),
        iban_to: firstString(record, ["iban_to", "ibanTo", "recipient_iban", "account_to"]) || this.options.iban,
        raw_payload: record,
      };
    });
  }
}
