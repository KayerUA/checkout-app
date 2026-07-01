import type { BankStatementProvider, BankTransaction } from "@/lib/bank/types";

export class MockBankStatementProvider implements BankStatementProvider {
  constructor(private transactions: BankTransaction[] = []) {}

  async fetchTransactions(from: Date, to: Date) {
    return this.transactions.filter(
      (tx) => tx.transaction_date >= from && tx.transaction_date <= to
    );
  }
}
