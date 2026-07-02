import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  provider: z.string().default("nova_poshta"),
  isEnabled: z.boolean(),
  config: z.object({
    flatRateKopiyky: z.number().int().optional(),
    apiKey: z.string().optional(),
  }),
});

export async function PATCH(request: NextRequest) {
  const session = await requireMerchantSession();
  const body = schema.parse(await request.json());
  const existing = await prisma.shippingProviderConfig.findUnique({
    where: {
      merchantId_provider: {
        merchantId: session.merchantId,
        provider: body.provider,
      },
    },
  });

  const existingConfig = (existing?.config ?? {}) as Record<string, string | number>;
  const cleanConfig = Object.fromEntries(
    Object.entries(body.config).filter(([, value]) => {
      if (typeof value === "string") return Boolean(value.trim());
      return typeof value !== "undefined";
    })
  ) as Record<string, string | number>;
  const mergedConfig = { ...existingConfig, ...cleanConfig };

  if (body.provider === "nova_poshta" && body.isEnabled && !mergedConfig.apiKey) {
    return NextResponse.json(
      { error: "Nova Poshta API key is required when provider is enabled" },
      { status: 400 }
    );
  }

  const config = await prisma.shippingProviderConfig.upsert({
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
      config: mergedConfig,
    },
    update: {
      isEnabled: body.isEnabled,
      config: mergedConfig,
    },
  });

  await createAuditLog({
    merchantId: session.merchantId,
    action: "shipping.updated",
    entityType: "ShippingProviderConfig",
    entityId: config.id,
  });

  return NextResponse.json({ ok: true });
}
