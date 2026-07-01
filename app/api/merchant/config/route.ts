import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const schema = z.object({
  themeConfig: z
    .object({
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      fontFamily: z.string().optional(),
      buttonText: z.string().optional(),
    })
    .optional(),
  checkoutBaseUrl: z.string().url().optional(),
  defaultLocale: z.string().optional(),
});

export async function GET() {
  const session = await requireMerchantSession();
  const merchant = await prisma.merchant.findUnique({
    where: { id: session.merchantId },
    select: {
      shopDomain: true,
      themeConfig: true,
      checkoutBaseUrl: true,
      defaultLocale: true,
      defaultCurrency: true,
      plan: true,
    },
  });
  return NextResponse.json(merchant);
}

export async function PATCH(request: NextRequest) {
  const session = await requireMerchantSession();
  const body = schema.parse(await request.json());

  const merchant = await prisma.merchant.update({
    where: { id: session.merchantId },
    data: {
      ...(body.checkoutBaseUrl ? { checkoutBaseUrl: body.checkoutBaseUrl } : {}),
      ...(body.defaultLocale ? { defaultLocale: body.defaultLocale } : {}),
      ...(body.themeConfig
        ? { themeConfig: body.themeConfig as Prisma.InputJsonValue }
        : {}),
    },
  });

  await createAuditLog({
    merchantId: session.merchantId,
    action: "merchant.config_updated",
    entityType: "merchant",
    entityId: merchant.id,
  });

  return NextResponse.json({ ok: true });
}
