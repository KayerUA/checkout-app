import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { reconcilePendingPayments } from "@/lib/payments/reconciliation";
import { reconcileBankPayments } from "@/lib/reconciliation/service";
import { markAbandonedSessions } from "@/lib/checkout/session-service";
import {
  parseTelegramCallback,
  parseTelegramCommand,
  splitTelegramMessage,
  summarizeAbandonedCheckouts,
  summarizeBankReconciliation,
  summarizePaymentReconciliation,
  telegramApi,
  telegramChatIsAllowed,
  telegramConfirmationKeyboard,
  telegramHelpMessage,
  telegramMainMenu,
  telegramUserIsAdmin,
} from "@/lib/telegram/bot";
import {
  buildCustomerSummary,
  buildHealthSummary,
  buildIssuesSummary,
  buildMappingGapsSummary,
  buildOrderCard,
  buildQueueSummary,
  buildSkuSummary,
  buildTodaySummary,
  buildUnmatchedSummary,
  buildWebhooksSummary,
  formatDiloshopActionResult,
  type TelegramOpsMessage,
} from "@/lib/telegram/operations";
import { resolveInvoicePdfForTelegram } from "@/lib/telegram/invoice-download";
import { runDiloshopOrderAction } from "@/lib/telegram/diloshop-client";
import {
  auditTelegram,
  claimTelegramCooldown,
  claimTelegramUpdate,
  withTelegramLock,
} from "@/lib/telegram/execution";

export const runtime = "nodejs";
export const maxDuration = 60;

type TelegramActor = {
  id?: number;
  username?: string;
  first_name?: string;
};

type TelegramMessage = {
  message_id?: number;
  text?: string;
  from?: TelegramActor;
  chat?: { id?: number; type?: string };
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: {
    id?: string;
    from?: TelegramActor;
    data?: string;
    message?: TelegramMessage;
  };
};

function secretsMatch(actual: string, expected: string) {
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function sendMessage(token: string, chatId: number, message: string | TelegramOpsMessage) {
  const value = typeof message === "string" ? { text: message } : message;
  return telegramApi<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: value.text.slice(0, 4000),
    disable_web_page_preview: true,
    ...(value.replyMarkup ? { reply_markup: value.replyMarkup } : {}),
  });
}

async function editMessage(
  token: string,
  chatId: number,
  messageId: number,
  message: string | TelegramOpsMessage
) {
  const value = typeof message === "string" ? { text: message } : message;
  return telegramApi(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: value.text.slice(0, 4000),
    disable_web_page_preview: true,
    reply_markup: value.replyMarkup ?? { inline_keyboard: [] },
  });
}

function isAdmin(userId: number, chatId: number) {
  const env = getEnv();
  return telegramUserIsAdmin(userId, env.TG_ADMIN_USER_IDS || env.TG_ALLOWED_CHAT_IDS) ||
    (chatId > 0 && userId === chatId && telegramChatIsAllowed(chatId, env.TG_ALLOWED_CHAT_IDS));
}

async function callbackResponse(update: TelegramUpdate) {
  const env = getEnv();
  const callback = update.callback_query;
  const callbackId = callback?.id;
  const chatId = callback?.message?.chat?.id;
  const messageId = callback?.message?.message_id;
  const userId = callback?.from?.id;
  if (!callbackId || !chatId || !messageId || !userId) return;

  await telegramApi(env.TG_BOT_TOKEN!, "answerCallbackQuery", {
    callback_query_id: callbackId,
  }).catch(() => {});

  if (!telegramChatIsAllowed(chatId, env.TG_ALLOWED_CHAT_IDS)) {
    await sendMessage(env.TG_BOT_TOKEN!, chatId, "Доступ к операциям запрещён.");
    return;
  }

  const parsed = parseTelegramCallback(callback?.data ?? "");
  const admin = isAdmin(userId, chatId);
  if (parsed.name === "menu") {
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, telegramMainMenu(true));
    return;
  }
  if (parsed.name === "order_help") {
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, {
      text: "Отправьте номер заказа отдельным сообщением — например UA1183.\n\nТакже работают /order UA1183, /customer +380… и /sku LUX-COY.",
      replyMarkup: { inline_keyboard: [[{ text: "⌂ Главное меню", callback_data: "menu" }]] },
    });
    return;
  }
  if (parsed.name === "cancel") {
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, "Действие отменено.");
    return;
  }
  if (parsed.name === "send-invoice") {
    try {
      const invoice = await resolveInvoicePdfForTelegram(parsed.orderId);
      if ("error" in invoice) {
        await sendMessage(env.TG_BOT_TOKEN!, chatId, `Не удалось скачать счёт: ${invoice.error}`);
        return;
      }
      await telegramApi(env.TG_BOT_TOKEN!, "sendDocument", {
        chat_id: chatId,
        document: invoice.url,
        caption: `Рахунок ${invoice.number} · ${invoice.orderName}`,
      });
      await auditTelegram({
        userId,
        chatId,
        command: "send-invoice",
        status: "OK",
        shopifyOrderId: parsed.orderId,
        message: invoice.number,
      }).catch(() => {});
    } catch (error) {
      await auditTelegram({
        userId,
        chatId,
        command: "send-invoice",
        status: "ERROR",
        shopifyOrderId: parsed.orderId,
        error,
      }).catch(() => {});
      await sendMessage(
        env.TG_BOT_TOKEN!,
        chatId,
        `Не удалось скачать счёт: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500)
      );
    }
    return;
  }
  if (parsed.name === "confirm") {
    if (!admin) {
      await sendMessage(env.TG_BOT_TOKEN!, chatId, "Эта операция доступна только администратору.");
      return;
    }
    await sendMessage(env.TG_BOT_TOKEN!, chatId, {
      text: `Подтвердите действие ${parsed.action} для Shopify order ${parsed.orderId}.`,
      replyMarkup: telegramConfirmationKeyboard(parsed.action, parsed.orderId),
    });
    return;
  }
  if (parsed.name === "run") {
    if (!admin) {
      await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, "Операция запрещена: нужен admin user ID.");
      return;
    }
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, "Операция выполняется…");
    try {
      const result = await withTelegramLock(
        `action:${parsed.action}:${parsed.orderId}`,
        () => runDiloshopOrderAction(
          parsed.action as "retry-dilovod" | "retry-np" | "refresh-np",
          parsed.orderId
        )
      );
      await auditTelegram({
        userId,
        chatId,
        command: `action:${parsed.action}`,
        status: "OK",
        shopifyOrderId: parsed.orderId,
        message: formatDiloshopActionResult(parsed.action, result),
      }).catch(() => {});
      const card = await buildOrderCard(parsed.orderId, { admin });
      card.text = `${formatDiloshopActionResult(parsed.action, result)}\n\n${card.text}`;
      await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, card);
    } catch (error) {
      const detail = error instanceof Error && error.message === "ALREADY_RUNNING"
        ? "Эта операция уже выполняется."
        : `Операция не выполнена: ${error instanceof Error ? error.message : String(error)}`;
      await auditTelegram({
        userId,
        chatId,
        command: `action:${parsed.action}`,
        status: "ERROR",
        shopifyOrderId: parsed.orderId,
        error,
      }).catch(() => {});
      await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, detail.slice(0, 1000));
    }
    return;
  }

  let response: TelegramOpsMessage;
  if (parsed.name === "today") response = await buildTodaySummary();
  else if (parsed.name === "unmatched") response = await buildUnmatchedSummary(parsed.days);
  else if (parsed.name === "abandoned") {
    await markAbandonedSessions();
    const sessions = await prisma.checkoutSession.findMany({
      where: { status: "ABANDONED", OR: [{ buyerPhone: { not: "" } }, { buyerEmail: { not: "" } }] },
      orderBy: { abandonedAt: "desc" }, take: parsed.take,
      include: { lines: { select: { title: true, quantity: true } } },
    });
    response = { text: summarizeAbandonedCheckouts(sessions), replyMarkup: { inline_keyboard: [[{ text: "⌂ Главное меню", callback_data: "menu" }]] } };
  } else if (parsed.name === "online_payments") {
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, "Проверяю ожидающие LiqPay/Monobank оплаты…");
    const result = await withTelegramLock("online-payments", () => reconcilePendingPayments({ take: parsed.take }));
    response = { text: summarizePaymentReconciliation(result), replyMarkup: { inline_keyboard: [[{ text: "⌂ Главное меню", callback_data: "menu" }]] } };
  } else if (parsed.name === "payments") {
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, `Сверяю банковские оплаты за ${parsed.days} дн.…`);
    const result = await withTelegramLock("bank-payments", () => {
      const to = new Date();
      return reconcileBankPayments({ from: new Date(to.getTime() - parsed.days * 24 * 60 * 60 * 1000), to });
    });
    response = { text: summarizeBankReconciliation(result), replyMarkup: { inline_keyboard: [[{ text: "⌂ Главное меню", callback_data: "menu" }]] } };
  } else if (parsed.name === "order") response = await buildOrderCard(parsed.orderId, { admin });
  else if (parsed.name === "lookup") response = await buildOrderCard(parsed.reference, { admin });
  else if (parsed.name === "issues") response = await buildIssuesSummary(parsed.hours, parsed.filter);
  else if (parsed.name === "health") response = await buildHealthSummary();
  else if (parsed.name === "queue") response = await buildQueueSummary();
  else response = { text: "Кнопка устарела. Запустите команду ещё раз." };
  await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, response);
}

async function commandResponse(update: TelegramUpdate) {
  const env = getEnv();
  const message = update.message;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  const text = message?.text;
  if (!chatId || !userId || !text) return;

  const normalizedText = text.trim();
  const commandText = normalizedText.startsWith("/")
    ? normalizedText
    : /^#?UA[\s_-]*\d{1,8}$/i.test(normalizedText)
      ? `/order ${normalizedText}`
      : "";
  if (!commandText) return;

  const command = parseTelegramCommand(commandText);
  const allowed = telegramChatIsAllowed(chatId, env.TG_ALLOWED_CHAT_IDS);
  const admin = isAdmin(userId, chatId);

  if (command.name === "myid") {
    await sendMessage(env.TG_BOT_TOKEN!, chatId, `Chat ID: ${chatId}\nUser ID: ${userId}`);
    return;
  }
  if (command.name === "menu") {
    await sendMessage(env.TG_BOT_TOKEN!, chatId, telegramMainMenu(allowed));
    return;
  }
  if (command.name === "help" || command.name === "unknown") {
    await sendMessage(env.TG_BOT_TOKEN!, chatId, telegramHelpMessage(allowed));
    return;
  }
  if (!allowed) {
    await sendMessage(env.TG_BOT_TOKEN!, chatId, `Доступ запрещён. Chat ID: ${chatId}.`);
    return;
  }
  if (!(await claimTelegramCooldown(userId, command.name))) {
    await sendMessage(env.TG_BOT_TOKEN!, chatId, "Команда уже запускалась. Подождите несколько секунд.");
    return;
  }

  try {
    let response: TelegramOpsMessage | null = null;
    if (["order", "np", "b2b", "cashin", "refund"].includes(command.name)) {
      response = await buildOrderCard(command.arg ?? "", { admin });
    } else if (command.name === "issues") {
      response = await buildIssuesSummary(command.hours ?? 24, command.filter);
    } else if (command.name === "today") {
      response = await buildTodaySummary();
    } else if (command.name === "health" || command.name === "status") {
      response = await buildHealthSummary();
    } else if (command.name === "queue") {
      response = await buildQueueSummary();
    } else if (command.name === "unmatched") {
      response = await buildUnmatchedSummary(command.days ?? 7);
    } else if (command.name === "sku") {
      response = await buildSkuSummary(command.arg ?? "");
    } else if (command.name === "customer") {
      response = await buildCustomerSummary(command.arg ?? "", chatId > 0 && admin);
    } else if (command.name === "webhooks") {
      response = await buildWebhooksSummary(command.hours ?? 24);
    } else if (command.name === "mapping_gaps") {
      response = await buildMappingGapsSummary();
    }
    if (response) {
      await sendMessage(env.TG_BOT_TOKEN!, chatId, response);
      await auditTelegram({ userId, chatId, command: command.name, status: "OK" }).catch(() => {});
      return;
    }

    if (command.name === "payments") {
      const days = command.days ?? 7;
      await sendMessage(env.TG_BOT_TOKEN!, chatId, `Сверяю банковские оплаты за ${days} дн.…`);
      const result = await withTelegramLock("bank-payments", () => {
        const to = new Date();
        const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        return reconcileBankPayments({ from, to });
      });
      await sendMessage(env.TG_BOT_TOKEN!, chatId, summarizeBankReconciliation(result));
    } else if (command.name === "abandoned") {
      await markAbandonedSessions();
      const sessions = await prisma.checkoutSession.findMany({
        where: {
          status: "ABANDONED",
          OR: [{ buyerPhone: { not: "" } }, { buyerEmail: { not: "" } }],
        },
        orderBy: { abandonedAt: "desc" },
        take: command.take ?? 10,
        include: { lines: { select: { title: true, quantity: true } } },
      });
      for (const chunk of splitTelegramMessage(summarizeAbandonedCheckouts(sessions))) {
        await sendMessage(env.TG_BOT_TOKEN!, chatId, chunk);
      }
    } else {
      await sendMessage(env.TG_BOT_TOKEN!, chatId, "Проверяю ожидающие LiqPay/Monobank оплаты…");
      const result = await withTelegramLock("online-payments", () =>
        reconcilePendingPayments({ take: command.take ?? 20 })
      );
      await sendMessage(env.TG_BOT_TOKEN!, chatId, summarizePaymentReconciliation(result));
    }
    await auditTelegram({ userId, chatId, command: command.name, status: "OK" }).catch(() => {});
  } catch (error) {
    const alreadyRunning = error instanceof Error && error.message === "ALREADY_RUNNING";
    await auditTelegram({
      userId,
      chatId,
      command: command.name,
      status: alreadyRunning ? "WARN" : "ERROR",
      error,
    }).catch(() => {});
    await sendMessage(
      env.TG_BOT_TOKEN!,
      chatId,
      alreadyRunning
        ? "Такая проверка уже выполняется другим пользователем. Дождитесь результата."
        : "Команда не завершилась. Ошибка записана в журнал."
    ).catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  const env = getEnv();
  if (!env.TG_BOT_TOKEN || !env.TG_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Telegram bot is not configured" }, { status: 503 });
  }
  if (!secretsMatch(request.headers.get("x-telegram-bot-api-secret-token") ?? "", env.TG_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  if (typeof update.update_id === "number" && !(await claimTelegramUpdate(update.update_id))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  try {
    if (update.callback_query) await callbackResponse(update);
    else await commandResponse(update);
  } catch (error) {
    console.error("Telegram bot update failed", {
      updateId: update.update_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return NextResponse.json({ ok: true });
}
