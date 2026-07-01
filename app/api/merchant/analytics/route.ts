import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  ga4MeasurementId: z.string().optional(),
  metaPixelId: z.string().optional(),
  metaAccessToken: z.string().optional(),
  gtmContainerId: z.string().optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await requireMerchantSession();
  const body = schema.parse(await request.json());

  const config = await prisma.analyticsConfig.upsert({
    where: { merchantId: session.merchantId },
    create: { merchantId: session.merchantId, ...body },
    update: body,
  });

  await createAuditLog({
    merchantId: session.merchantId,
    action: "analytics.updated",
    entityType: "AnalyticsConfig",
    entityId: config.id,
  });

  return NextResponse.json({ ok: true });
}
