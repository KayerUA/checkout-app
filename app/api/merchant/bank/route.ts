import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { createAuditLog } from "@/lib/audit";
import { PRIVATBANK_CONFIG_PROVIDER, getPrivatBankConfigForMerchant } from "@/lib/bank/config";
import { PrivatBankStatementProvider } from "@/lib/bank/privatbank-provider";

const patchSchema = z.object({
  isEnabled: z.boolean(),
  config: z.object({
    apiUrl: z.string().url().optional(),
    clientId: z.string().optional(),
    token: z.string().optional(),
    iban: z.string().optional(),
  }),
});

function cleanConfig(config: z.infer<typeof patchSchema>["config"]) {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => typeof value === "string" && value.trim())
  ) as Record<string, string>;
}

export async function GET() {
  try {
    const session = await requireMerchantSession();
    const config = await getPrivatBankConfigForMerchant(session.merchantId);
    return NextResponse.json({
      isEnabled: config.isEnabled,
      apiUrl: config.apiUrl ?? "https://acp.privatbank.ua/api/statements/transactions",
      clientId: config.clientId ?? "",
      iban: config.iban ?? "",
      hasToken: Boolean(config.token),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load bank config" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireMerchantSession();
    const body = patchSchema.parse(await request.json());
    const existing = await prisma.shippingProviderConfig.findUnique({
      where: {
        merchantId_provider: {
          merchantId: session.merchantId,
          provider: PRIVATBANK_CONFIG_PROVIDER,
        },
      },
    });

    const existingConfig = (existing?.config ?? {}) as Record<string, string>;
    const mergedConfig = { ...existingConfig, ...cleanConfig(body.config) };

    if (body.isEnabled) {
      if (!mergedConfig.token || !mergedConfig.iban) {
        return NextResponse.json(
          { error: "Privat24 token and IBAN are required when provider is enabled" },
          { status: 400 }
        );
      }
    }

    const config = await prisma.shippingProviderConfig.upsert({
      where: {
        merchantId_provider: {
          merchantId: session.merchantId,
          provider: PRIVATBANK_CONFIG_PROVIDER,
        },
      },
      create: {
        merchantId: session.merchantId,
        provider: PRIVATBANK_CONFIG_PROVIDER,
        isEnabled: body.isEnabled,
        config: mergedConfig,
      },
      update: {
        isEnabled: body.isEnabled,
        config: mergedConfig,
      },
    });

    await createAuditLog({
      merchantId: session.merchantId,
      action: "bank.privat24_updated",
      entityType: "ShippingProviderConfig",
      entityId: config.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save bank config" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await requireMerchantSession();
    const config = await getPrivatBankConfigForMerchant(session.merchantId);
    if (!config.isEnabled || !config.token || !config.iban) {
      return NextResponse.json({ error: "Privat24 provider is not configured" }, { status: 400 });
    }

    const provider = new PrivatBankStatementProvider({
      apiUrl: config.apiUrl,
      token: config.token,
      clientId: config.clientId,
      iban: config.iban,
    });
    const to = new Date();
    const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const transactions = await provider.fetchTransactions(from, to);
    return NextResponse.json({
      ok: true,
      checkedFrom: from,
      checkedTo: to,
      transactions: transactions.length,
      sample: transactions.slice(0, 3).map((tx) => ({
        transaction_id: tx.transaction_id,
        transaction_date: tx.transaction_date,
        payer_name: tx.payer_name,
        amount: tx.amount,
        currency: tx.currency,
        payment_description: tx.payment_description,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Privat24 test failed" },
      { status: 500 }
    );
  }
}
