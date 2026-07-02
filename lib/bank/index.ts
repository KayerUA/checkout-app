import { getEnv } from "@/lib/env";
import { MockBankStatementProvider } from "@/lib/bank/mock-provider";
import { PrivatBankStatementProvider } from "@/lib/bank/privatbank-provider";
import { getDefaultPrivatBankConfig } from "@/lib/bank/config";
import type { BankStatementProvider } from "@/lib/bank/types";

export async function getBankStatementProvider(): Promise<BankStatementProvider> {
  const env = getEnv();
  const dbPrivatBank = await getDefaultPrivatBankConfig();
  if (dbPrivatBank.isEnabled && dbPrivatBank.token) {
    return new PrivatBankStatementProvider({
      apiUrl: dbPrivatBank.apiUrl,
      token: dbPrivatBank.token,
      clientId: dbPrivatBank.clientId,
      iban: dbPrivatBank.iban,
    });
  }
  if (env.BANK_PROVIDER === "mock") return new MockBankStatementProvider();
  if (env.BANK_PROVIDER === "privatbank") {
    return new PrivatBankStatementProvider({
      apiUrl: env.BANK_API_URL,
      token: env.BANK_API_TOKEN,
      clientId: process.env.BANK_API_CLIENT_ID,
      iban: env.BANK_ACCOUNT_IBAN,
    });
  }
  return new MockBankStatementProvider();
}
