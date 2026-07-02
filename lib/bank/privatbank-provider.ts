import type { BankStatementProvider, BankTransaction } from "@/lib/bank/types";

const DEFAULT_API_URL = "https://acp.privatbank.ua/api/statements/transactions";

type PrivatBankProviderOptions = {
  apiUrl?: string;
  token?: string;
  clientId?: string;
  iban?: string;
  limit?: number;
};

type PrivatTransaction = Record<string, string | number | boolean | null | undefined>;

function formatPrivatDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

function parsePrivatDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return new Date();
  const dateTime = value.trim();
  const [datePart, timePart = "00:00:00"] = dateTime.split(/\s+/);
  const [day, month, year] = datePart.split(/[.-]/).map(Number);
  if (!day || !month || !year) return new Date(value);
  const [hour = 0, minute = 0, second = 0] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

function text(record: PrivatTransaction, key: string) {
  const value = record[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function money(record: PrivatTransaction, key: string) {
  const value = record[key];
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeTransactionId(record: PrivatTransaction, index: number) {
  const technical = text(record, "TECHNICAL_TRANSACTION_ID");
  if (technical) return technical;
  const ref = text(record, "REF");
  const refn = text(record, "REFN");
  if (ref || refn) return `${ref}${refn}`;
  const id = text(record, "ID");
  if (id) return id;
  return `privatbank_${text(record, "DAT_OD")}_${text(record, "TIM_P")}_${index}`;
}

function mapTransaction(record: PrivatTransaction, index: number, iban?: string): BankTransaction | null {
  const transactionType = text(record, "TRANTYPE");
  const processingStatus = text(record, "PR_PR");
  const realStatus = text(record, "FL_REAL");

  if (transactionType && transactionType !== "C") return null;
  if (processingStatus && processingStatus !== "r") return null;
  if (realStatus && realStatus !== "r") return null;

  return {
    provider: "privatbank",
    transaction_id: makeTransactionId(record, index),
    transaction_date: parsePrivatDate(text(record, "DATE_TIME_DAT_OD_TIM_P") || text(record, "DAT_OD")),
    payer_name: text(record, "AUT_CNTR_NAM"),
    payer_tax_id: text(record, "AUT_CNTR_CRF"),
    amount: money(record, "SUM"),
    currency: text(record, "CCY") || "UAH",
    payment_description: text(record, "OSND"),
    iban_from: text(record, "AUT_CNTR_ACC"),
    iban_to: iban || text(record, "AUT_MY_ACC"),
    raw_payload: record,
  };
}

export class PrivatBankStatementProvider implements BankStatementProvider {
  constructor(private options: PrivatBankProviderOptions) {}

  async fetchTransactions(from: Date, to: Date): Promise<BankTransaction[]> {
    if (!this.options.token) {
      throw new Error("PrivatBank provider requires token");
    }

    const transactions: BankTransaction[] = [];
    let followId: string | undefined;
    let page = 0;

    do {
      const url = new URL(this.options.apiUrl || DEFAULT_API_URL);
      if (this.options.iban) url.searchParams.set("acc", this.options.iban);
      url.searchParams.set("startDate", formatPrivatDate(from));
      url.searchParams.set("endDate", formatPrivatDate(to));
      url.searchParams.set("limit", String(this.options.limit ?? 100));
      if (followId) url.searchParams.set("followId", followId);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": this.options.clientId || "KAYER Checkout",
          token: this.options.token,
          "Content-Type": "application/json;charset=cp1251",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`PrivatBank statement fetch failed: ${await response.text()}`);
      }

      const payload = (await response.json()) as {
        status?: string;
        error?: string;
        message?: string;
        exist_next_page?: boolean;
        next_page_id?: string;
        transactions?: PrivatTransaction[];
      };

      if (payload.status && payload.status !== "SUCCESS") {
        throw new Error(payload.error || payload.message || "PrivatBank API returned non-success status");
      }

      for (const [index, record] of (payload.transactions ?? []).entries()) {
        const transaction = mapTransaction(record, page * 1000 + index, this.options.iban);
        if (transaction) transactions.push(transaction);
      }

      followId = payload.exist_next_page ? payload.next_page_id : undefined;
      page += 1;
    } while (followId && page < 20);

    return transactions;
  }
}
