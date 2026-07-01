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
  }),
});

export async function PATCH(request: NextRequest) {
  const session = await requireMerchantSession();
  const body = schema.parse(await request.json());

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
      config: body.config,
    },
    update: {
      isEnabled: body.isEnabled,
      config: body.config,
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
