import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

export async function writeAutomationLog(input: {
  shopifyOrderId?: string;
  eventType?: string;
  step?: string;
  status: "OK" | "WARN" | "ERROR";
  message?: string;
  error?: unknown;
  metadata?: Prisma.InputJsonValue;
}) {
  const errorMessage = input.error instanceof Error ? input.error.message : undefined;
  log(input.status === "ERROR" ? "error" : input.status === "WARN" ? "warn" : "info", input.message ?? input.step ?? "B2B automation", {
    shopifyOrderId: input.shopifyOrderId,
    eventType: input.eventType,
    step: input.step,
  });

  await prisma.automationLog.create({
    data: {
      shopifyOrderId: input.shopifyOrderId,
      eventType: input.eventType,
      step: input.step,
      status: input.status,
      message: input.message,
      errorMessage,
      metadata: input.metadata,
    },
  });
}
