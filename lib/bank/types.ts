export type BankTransaction = {
  provider: string;
  transaction_id: string;
  transaction_date: Date;
  payer_name?: string;
  payer_tax_id?: string;
  amount: number;
  currency: string;
  payment_description?: string;
  iban_from?: string;
  iban_to?: string;
  raw_payload: unknown;
};

export interface BankStatementProvider {
  fetchTransactions(from: Date, to: Date): Promise<BankTransaction[]>;
}
