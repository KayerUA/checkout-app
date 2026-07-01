import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function createAuditLog(params: {
  merchantId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      merchantId: params.merchantId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
