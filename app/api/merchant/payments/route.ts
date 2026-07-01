import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  provider: z.enum(["MONOBANK", "LIQPAY"]),
  isEnabled: z.boolean(),
  isSandbox: z.boolean().optional(),
  config: z.record(z.string(), z.string()),
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
      config: body.config,
    },
    update: {
      isEnabled: body.isEnabled,
      isSandbox: body.isSandbox,
      config: body.config,
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
