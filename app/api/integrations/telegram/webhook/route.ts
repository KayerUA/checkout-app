import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { reconcilePendingPayments } from "@/lib/payments/reconciliation";
import {
  parseTelegramCommand,
  summarizePaymentReconciliation,
  telegramApi,
  telegramChatIsAllowed,
  telegramHelpMessage,
} from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const maxDuration = 60;

type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

function secretsMatch(actual: string, expected: string) {
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function sendMessage(token: string, chatId: number, text: string) {
  await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
  });
}

export async function POST(request: NextRequest) {
  const env = getEnv();
  if (!env.TG_BOT_TOKEN || !env.TG_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Telegram bot is not configured" }, { status: 503 });
  }
  if (
    !secretsMatch(
      request.headers.get("x-telegram-bot-api-secret-token") ?? "",
      env.TG_WEBHOOK_SECRET
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (!chatId || !text?.startsWith("/")) {
    return NextResponse.json({ ok: true });
  }

  const command = parseTelegramCommand(text);
  const allowed = telegramChatIsAllowed(chatId, env.TG_ALLOWED_CHAT_IDS);

  try {
    if (command.name === "myid") {
      await sendMessage(env.TG_BOT_TOKEN, chatId, `Chat ID: ${chatId}`);
      return NextResponse.json({ ok: true });
    }
    if (command.name === "help" || command.name === "unknown") {
      await sendMessage(env.TG_BOT_TOKEN, chatId, telegramHelpMessage(allowed));
      return NextResponse.json({ ok: true });
    }
    if (!allowed) {
      await sendMessage(
        env.TG_BOT_TOKEN,
        chatId,
        `Доступ запрещён. Chat ID: ${chatId}. Добавьте его в TG_ALLOWED_CHAT_IDS.`
      );
      return NextResponse.json({ ok: true });
    }

    if (command.name === "status") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [pending, paid24h, failed24h] = await Promise.all([
        prisma.paymentAttempt.count({ where: { status: "PENDING" } }),
        prisma.paymentAttempt.count({ where: { status: "PAID", updatedAt: { gte: since } } }),
        prisma.paymentAttempt.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
      ]);
      await sendMessage(
        env.TG_BOT_TOKEN,
        chatId,
        [
          "Статус оплат:",
          `Ожидают проверки: ${pending}`,
          `Оплачено за 24 ч: ${paid24h}`,
          `Неуспешно за 24 ч: ${failed24h}`,
        ].join("\n")
      );
      return NextResponse.json({ ok: true });
    }

    await sendMessage(env.TG_BOT_TOKEN, chatId, "Запускаю проверку ожидающих оплат…");
    const result = await reconcilePendingPayments({ take: command.take });
    await sendMessage(env.TG_BOT_TOKEN, chatId, summarizePaymentReconciliation(result));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram payments bot command failed", {
      updateId: update.update_id,
      chatId,
      command: command.name,
      error: error instanceof Error ? error.message : String(error),
    });
    await sendMessage(
      env.TG_BOT_TOKEN,
      chatId,
      "Проверка не завершилась. Ошибка записана в журнал, попробуйте позже."
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }
}
