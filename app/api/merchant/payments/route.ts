import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  provider: z.enum(["MONOBANK", "LIQPAY"]),
  isEnabled: z.boolean(),
  isSandbox: z.boolean().optional(),
  config: z.record(z.string(), z.string().optional()),
});

export async function GET() {
  const session = await requireMerchantSession();
  const configs = await prisma.paymentProviderConfig.findMany({
    where: { merchantId: session.merchantId },
  });
  return NextResponse.json(configs.map((c) => ({
    ...c,
    config: { ...c.config as object, privateKey: "[redacted]", token: "[redacted]" },
  })));
}

export async function PATCH(request: NextRequest) {
  const session = await requireMerchantSession();
  const body = schema.parse(await request.json());
  const existing = await prisma.paymentProviderConfig.findUnique({
    where: {
      merchantId_provider: {
        merchantId: session.merchantId,
        provider: body.provider,
      },
    },
  });

  const existingConfig = (existing?.config ?? {}) as Record<string, string>;
  const cleanConfig = Object.fromEntries(
    Object.entries(body.config).filter(([, value]) => typeof value === "string" && value.trim())
  ) as Record<string, string>;
  const mergedConfig = { ...existingConfig, ...cleanConfig };

  if (body.provider === "LIQPAY" && body.isEnabled) {
    if (!mergedConfig.publicKey || !mergedConfig.privateKey) {
      return NextResponse.json(
        { error: "LiqPay publicKey and privateKey are required when provider is enabled" },
        { status: 400 }
      );
    }
  }

  const config = await prisma.paymentProviderConfig.upsert({
    where: {
      merchantId_provider: {
        merchantId: session.merchantId,
        provider: body.provider,
      },
    },
    create: {
      merchantId: session.merchantId,
      provider: body.provider,
      isEnabled: body.isEnabled,
      isSandbox: body.isSandbox ?? true,
      config: mergedConfig,
    },
    update: {
      isEnabled: body.isEnabled,
      isSandbox: body.isSandbox,
      config: mergedConfig,
    },
  });

  await createAuditLog({
    merchantId: session.merchantId,
    action: "payments.updated",
    entityType: "PaymentProviderConfig",
    entityId: config.id,
  });

  return NextResponse.json({ ok: true, id: config.id });
}
