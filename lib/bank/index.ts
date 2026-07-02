import { getEnv } from "@/lib/env";
import { MockBankStatementProvider } from "@/lib/bank/mock-provider";
import { PrivatBankStatementProvider } from "@/lib/bank/privatbank-provider";
import type { BankStatementProvider } from "@/lib/bank/types";

export function getBankStatementProvider(): BankStatementProvider {
  const env = getEnv();
  if (env.BANK_PROVIDER === "mock") return new MockBankStatementProvider();
  if (env.BANK_PROVIDER === "privatbank") {
    return new PrivatBankStatementProvider({
      apiUrl: env.BANK_API_URL,
      token: env.BANK_API_TOKEN,
      iban: env.BANK_ACCOUNT_IBAN,
    });
  }
  return new MockBankStatementProvider();
}
