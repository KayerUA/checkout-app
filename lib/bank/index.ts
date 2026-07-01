import { getEnv } from "@/lib/env";
import { MockBankStatementProvider } from "@/lib/bank/mock-provider";
import type { BankStatementProvider } from "@/lib/bank/types";

export function getBankStatementProvider(): BankStatementProvider {
  const env = getEnv();
  if (env.BANK_PROVIDER === "mock") return new MockBankStatementProvider();
  return new MockBankStatementProvider();
}
