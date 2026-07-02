import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const PRIVATBANK_CONFIG_PROVIDER = "privatbank_autoclient";

export type PrivatBankConfig = {
  provider: "privatbank";
  isEnabled: boolean;
  apiUrl?: string;
  clientId?: string;
  token?: string;
  iban?: string;
};

function normalizeConfig(config: Record<string, unknown>, isEnabled: boolean): PrivatBankConfig {
  return {
    provider: "privatbank",
    isEnabled,
    apiUrl: typeof config.apiUrl === "string" ? config.apiUrl : undefined,
    clientId: typeof config.clientId === "string" ? config.clientId : undefined,
    token: typeof config.token === "string" ? config.token : undefined,
    iban: typeof config.iban === "string" ? config.iban : undefined,
  };
}

export async function getPrivatBankConfigForMerchant(merchantId: string) {
  const record = await prisma.shippingProviderConfig.findUnique({
    where: {
      merchantId_provider: {
        merchantId,
        provider: PRIVATBANK_CONFIG_PROVIDER,
      },
    },
  });
  return normalizeConfig((record?.config ?? {}) as Record<string, unknown>, record?.isEnabled ?? false);
}

export async function getDefaultPrivatBankConfig() {
  const env = getEnv();
  if (env.SHOPIFY_SHOP_DOMAIN) {
    const merchant = await prisma.merchant.findUnique({
      where: { shopDomain: env.SHOPIFY_SHOP_DOMAIN },
      select: { id: true },
    });
    if (merchant) {
      const config = await getPrivatBankConfigForMerchant(merchant.id);
      if (config.isEnabled && config.token) return config;
    }
  }

  return {
    provider: "privatbank" as const,
    isEnabled: env.BANK_PROVIDER === "privatbank",
    apiUrl: env.BANK_API_URL,
    clientId: process.env.BANK_API_CLIENT_ID,
    token: env.BANK_API_TOKEN,
    iban: env.BANK_ACCOUNT_IBAN,
  };
}
