import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const schema = z.object({
  isEnabled: z.boolean(),
  licenseKey: z.string().optional(),
  cashRegister: z.string().optional(),
  cashierPin: z.string().optional(),
  fiscalPolicy: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await requireMerchantSession();
  const body = schema.parse(await request.json());
  const data = {
    ...body,
    fiscalPolicy: body.fiscalPolicy as Prisma.InputJsonValue | undefined,
  };

  const config = await prisma.fiscalConfig.upsert({
    where: { merchantId: session.merchantId },
    create: { merchantId: session.merchantId, ...data },
    update: data,
  });

  await createAuditLog({
    merchantId: session.merchantId,
    action: "fiscal.updated",
    entityType: "FiscalConfig",
    entityId: config.id,
  });

  return NextResponse.json({ ok: true });
}
