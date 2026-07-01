import type { BankStatementProvider, BankTransaction } from "@/lib/bank/types";

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else current += char;
  }
  values.push(current.trim());
  return values.map((value) => value.replace(/^"|"$/g, ""));
}

export class ManualImportCsvProvider implements BankStatementProvider {
  constructor(private csv: string, private provider = "manual_csv") {}

  async fetchTransactions(from: Date, to: Date) {
    const [headerLine, ...rows] = this.csv.trim().split(/\r?\n/);
    if (!headerLine) return [];
    const headers = splitCsvLine(headerLine);
    const transactions = rows.map((row) => {
      const values = splitCsvLine(row);
      const record = headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = values[index] ?? "";
        return acc;
      }, {});
      const transaction: BankTransaction = {
        provider: record.provider || this.provider,
        transaction_id: record.transaction_id,
        transaction_date: new Date(record.transaction_date),
        payer_name: record.payer_name,
        payer_tax_id: record.payer_tax_id,
        amount: Number(record.amount),
        currency: record.currency || "UAH",
        payment_description: record.payment_description,
        iban_from: record.iban_from,
        iban_to: record.iban_to,
        raw_payload: record,
      };
      return transaction;
    });

    return transactions.filter(
      (tx) => tx.transaction_date >= from && tx.transaction_date <= to
    );
  }
}
