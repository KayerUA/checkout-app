import { prisma } from "@/lib/db";
import { writeAutomationLog } from "@/lib/b2b/log";

async function claimLease(scope: string, key: string, ttlMs: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.idempotencyKey.create({
      data: { scope, key, expiresAt, responseSnapshot: { status: "PROCESSING" } },
    });
    return true;
  } catch {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!existing?.expiresAt || existing.expiresAt >= now) return false;
    const reclaimed = await prisma.idempotencyKey.updateMany({
      where: { id: existing.id, expiresAt: { lt: now } },
      data: { expiresAt, responseSnapshot: { status: "PROCESSING" } },
    });
    return reclaimed.count === 1;
  }
}

export function claimTelegramUpdate(updateId: number) {
  return claimLease("telegram-update", String(updateId), 7 * 24 * 60 * 60 * 1000);
}

export function claimTelegramCooldown(userId: number, command: string, seconds = 5) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  return claimLease(
    "telegram-cooldown",
    `${userId}:${command}:${bucket}`,
    (seconds + 2) * 1000
  );
}

export async function withTelegramLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const scope = "telegram-command-lock";
  const claimed = await claimLease(scope, key, 3 * 60 * 1000);
  if (!claimed) throw new Error("ALREADY_RUNNING");
  try {
    const result = await action();
    await prisma.idempotencyKey.deleteMany({ where: { scope, key } });
    return result;
  } catch (error) {
    await prisma.idempotencyKey.updateMany({
      where: { scope, key },
      data: { expiresAt: new Date(Date.now() + 30_000), responseSnapshot: { status: "FAILED" } },
    });
    throw error;
  }
}

export async function auditTelegram(input: {
  userId?: number;
  chatId: number;
  command: string;
  status: "OK" | "WARN" | "ERROR";
  shopifyOrderId?: string;
  message?: string;
  error?: unknown;
}) {
  await writeAutomationLog({
    shopifyOrderId: input.shopifyOrderId,
    eventType: "telegram/bot",
    step: input.command,
    status: input.status,
    message: input.message,
    error: input.error,
    metadata: {
      telegramUserId: input.userId ?? null,
      telegramChatId: input.chatId,
    },
  });
}
