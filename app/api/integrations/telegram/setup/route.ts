import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { telegramApi, telegramBotCommands } from "@/lib/telegram/bot";

export const runtime = "nodejs";

function authorized(request: NextRequest, expected: string) {
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const env = getEnv();
  if (!env.TG_BOT_TOKEN || !env.TG_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Telegram bot is not configured" }, { status: 503 });
  }
  if (!authorized(request, env.TG_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = `${env.APP_URL.replace(/\/$/, "")}/api/integrations/telegram/webhook`;
  await telegramApi(env.TG_BOT_TOKEN, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TG_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  await telegramApi(env.TG_BOT_TOKEN, "setMyCommands", {
    commands: telegramBotCommands,
  });

  const bot = await telegramApi<{ id: number; username?: string }>(env.TG_BOT_TOKEN, "getMe", {});
  const webhook = await telegramApi<{
    url: string;
    pending_update_count: number;
    last_error_message?: string;
  }>(env.TG_BOT_TOKEN, "getWebhookInfo", {});

  return NextResponse.json({
    ok: true,
    bot: { id: bot.id, username: bot.username ?? null },
    webhook: {
      url: webhook.url,
      pendingUpdates: webhook.pending_update_count,
      lastError: webhook.last_error_message ?? null,
    },
  });
}
