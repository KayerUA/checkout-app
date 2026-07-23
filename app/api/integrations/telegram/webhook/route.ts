import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { reconcilePendingPayments } from "@/lib/payments/reconciliation";
import { applyManualBankPaymentProposal, reconcileBankPayments } from "@/lib/reconciliation/service";
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
  prepareShopifyOrderRecovery,
  recoverShopifyOrderFromCheckout,
  buildSkuSummary,
  buildTodaySummary,
  buildUnmatchedSummary,
  buildWebhooksSummary,
  formatDiloshopActionResult,
  type TelegramOpsMessage,
} from "@/lib/telegram/operations";
import { resolveInvoicePdfForTelegram } from "@/lib/telegram/invoice-download";
import { runDiloshopOrderAction } from "@/lib/telegram/diloshop-client";
import type { Prisma } from "@prisma/client";
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
  const allowedChatIds = [env.TG_ALLOWED_CHAT_IDS, env.TG_EXTRA_ALLOWED_CHAT_IDS]
    .filter(Boolean)
    .join(",");
  const adminUserIds = [env.TG_ADMIN_USER_IDS, env.TG_EXTRA_ALLOWED_CHAT_IDS]
    .filter(Boolean)
    .join(",");
  return telegramUserIsAdmin(userId, adminUserIds || allowedChatIds) ||
    (chatId > 0 && userId === chatId && telegramChatIsAllowed(chatId, allowedChatIds));
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

  const allowedChatIds = [env.TG_ALLOWED_CHAT_IDS, env.TG_EXTRA_ALLOWED_CHAT_IDS]
    .filter(Boolean)
    .join(",");
  if (!telegramChatIsAllowed(chatId, allowedChatIds)) {
    await sendMessage(env.TG_BOT_TOKEN!, chatId, "Доступ к операциям запрещён.");
    return;
  }

  const parsed = parseTelegramCallback(callback?.data ?? "");
  const admin = isAdmin(userId, chatId);
  if (parsed.name === "menu") {
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, telegramMainMenu(true));
    return;
  }
  if (parsed.name === "bank_review") {
    const payments = await prisma.bankPayment.findMany({
      where: { status: "NEEDS_REVIEW" }, orderBy: { transactionDate: "desc" }, take: 20,
    });
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, {
      text: payments.length
        ? ["Платежі для ручного розбору:", ...payments.map((payment) =>
          `• ${payment.amount} ${payment.currency} · ${payment.payerName ?? "платник невідомий"} · …${payment.transactionId.slice(-8)}`
        )].join("\n")
        : "Платежів для ручного розбору немає.",
      replyMarkup: { inline_keyboard: [
        ...payments.map((payment) => [{ text: `${payment.amount} ${payment.currency} · …${payment.transactionId.slice(-8)}`, callback_data: `bank_payment|${payment.id}` }]),
        [{ text: "⌂ Головне меню", callback_data: "menu" }],
      ] },
    });
    return;
  }
  if (parsed.name === "bank_payment") {
    const payment = await prisma.bankPayment.findUnique({ where: { id: parsed.paymentId } });
    if (!payment) { await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, "Платіж не знайдено."); return; }
    const orders = payment.payerTaxId
      ? await prisma.b2BOrder.findMany({ where: { fopTaxId: payment.payerTaxId, status: { in: ["WAITING_BANK_PAYMENT", "NEEDS_REVIEW", "INVOICE_SENT"] } }, orderBy: { createdAt: "asc" }, take: 20 })
      : [];
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, {
      text: [
        "Ручний розбір банківського платежу",
        `Сума: ${payment.amount} ${payment.currency}`,
        `Платник: ${payment.payerName ?? "—"}`,
        `ІПН: ${payment.payerTaxId ?? "—"}`,
        `Призначення: ${payment.paymentDescription ?? "—"}`,
        `Transaction: …${payment.transactionId.slice(-12)}`,
      ].join("\n"),
      replyMarkup: { inline_keyboard: [
        ...orders.map((order) => [{ text: `${order.shopifyOrderName ?? order.shopifyOrderId} · ${order.expectedAmount ?? order.orderTotalAmount} UAH`, callback_data: `bank_select|${payment.id}|${order.shopifyOrderId}` }]),
        [{ text: "← До платежів", callback_data: "bank_review" }],
      ] },
    });
    return;
  }
  if (parsed.name === "bank_select") {
    const payment = await prisma.bankPayment.findUnique({ where: { id: parsed.paymentId } });
    const order = await prisma.b2BOrder.findUnique({ where: { shopifyOrderId: parsed.orderId } });
    if (!payment || !order) { await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, "Платіж або замовлення не знайдено."); return; }
    const raw = payment.rawPayload && typeof payment.rawPayload === "object" && !Array.isArray(payment.rawPayload)
      ? payment.rawPayload as Record<string, unknown> : {};
    const recon = raw._reconciliation && typeof raw._reconciliation === "object" && !Array.isArray(raw._reconciliation)
      ? raw._reconciliation as Record<string, unknown> : {};
    const details = recon.matching_details && typeof recon.matching_details === "object" && !Array.isArray(recon.matching_details)
      ? recon.matching_details as Record<string, unknown> : {};
    const previous = Array.isArray(details.candidates) ? details.candidates.filter((row) => row && typeof row === "object") as Record<string, unknown>[] : [];
    const exists = previous.some((row) => String(row.shopifyOrderId) === order.shopifyOrderId);
    const candidates = exists ? previous.filter((row) => String(row.shopifyOrderId) !== order.shopifyOrderId) : [...previous, { shopifyOrderId: order.shopifyOrderId, shopifyOrderName: order.shopifyOrderName, amount: Number(order.expectedAmount ?? order.orderTotalAmount ?? 0), currency: order.orderCurrency ?? payment.currency }];
    await prisma.bankPayment.update({ where: { id: payment.id }, data: { rawPayload: { ...raw, _reconciliation: { ...recon, matching_details: { ...details, candidates } } } as Prisma.InputJsonValue } });
    const selectedTotal = candidates.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const selectableOrders = payment.payerTaxId
      ? await prisma.b2BOrder.findMany({
          where: { fopTaxId: payment.payerTaxId, status: { in: ["WAITING_BANK_PAYMENT", "NEEDS_REVIEW", "INVOICE_SENT"] } },
          orderBy: { createdAt: "asc" },
          take: 20,
        })
      : [];
    const selectedIds = new Set(candidates.map((row) => String(row.shopifyOrderId)));
    await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, {
      text: `Вибрано: ${candidates.map((row) => row.shopifyOrderName ?? row.shopifyOrderId).join(", ") || "нічого"}\nСума вибраного: ${selectedTotal.toFixed(2)} ${payment.currency}\nПлатіж: ${Number(payment.amount).toFixed(2)} ${payment.currency}`,
      replyMarkup: { inline_keyboard: [
        ...selectableOrders.map((candidate) => [{
          text: `${selectedIds.has(candidate.shopifyOrderId) ? "✅" : "☐"} ${candidate.shopifyOrderName ?? candidate.shopifyOrderId} · ${candidate.expectedAmount ?? candidate.orderTotalAmount} UAH`,
          callback_data: `bank_select|${payment.id}|${candidate.shopifyOrderId}`,
        }]),
        [{ text: "✅ Підтвердити розподіл", callback_data: `confirm|apply-bank-proposal|${payment.id}` }],
        [{ text: "← До платежів", callback_data: "bank_review" }],
      ] },
    });
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
    const targetLabel = parsed.action === "recover-shopify-order"
      ? `checkout ${parsed.orderId}`
      : parsed.action === "apply-bank-proposal"
        ? "вибраних B2B-рахунків"
      : `Shopify order ${parsed.orderId}`;
    await sendMessage(env.TG_BOT_TOKEN!, chatId, {
      text: `Подтвердите действие ${parsed.action} для ${targetLabel}.`,
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
      let resultText: string;
      if (parsed.action === "recover-shopify-order") {
        const result = await withTelegramLock(
          `action:${parsed.action}:${parsed.orderId}`,
          () => recoverShopifyOrderFromCheckout(parsed.orderId)
        );
        resultText = `Shopify-заказ восстановлен: ${result.shopifyOrderName ?? result.shopifyOrderGid}.`;
      } else if (parsed.action === "apply-bank-proposal") {
        const result = await withTelegramLock(
          `action:${parsed.action}:${parsed.orderId}`,
          () => applyManualBankPaymentProposal({ bankPaymentId: parsed.orderId, toleranceUah: 1 })
        );
        resultText = result.alreadyApplied
          ? "Цей банківський платіж уже був розподілений."
          : [
              `Платіж розподілено: ${Number(result.expectedAmount ?? 0).toFixed(2)} UAH.`,
              `Допустиме округлення: ${Number(result.difference ?? 0).toFixed(2)} UAH.`,
              ...(result.results ?? []).map((row) => `${row.order ?? "замовлення"}: ${row.status}`),
            ].join("\n");
      } else {
        const result = await withTelegramLock(
          `action:${parsed.action}:${parsed.orderId}`,
          () => runDiloshopOrderAction(
            parsed.action as "retry-dilovod" | "retry-np" | "refresh-np",
            parsed.orderId
          )
        );
        resultText = formatDiloshopActionResult(parsed.action, result);
      }
      await auditTelegram({
        userId,
        chatId,
        command: `action:${parsed.action}`,
        status: "OK",
        shopifyOrderId: parsed.orderId,
        message: resultText,
      }).catch(() => {});
      if (parsed.action === "recover-shopify-order" || parsed.action === "apply-bank-proposal") {
        await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, resultText);
      } else {
        const card = await buildOrderCard(parsed.orderId, { admin });
        card.text = `${resultText}\n\n${card.text}`;
        await editMessage(env.TG_BOT_TOKEN!, chatId, messageId, card);
      }
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
  const allowed = telegramChatIsAllowed(
    chatId,
    [env.TG_ALLOWED_CHAT_IDS, env.TG_EXTRA_ALLOWED_CHAT_IDS].filter(Boolean).join(",")
  );
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
  if (command.name === "recover_checkout") {
    if (!admin) {
      await sendMessage(env.TG_BOT_TOKEN!, chatId, "Эта операция доступна только администратору.");
      return;
    }
    const recovery = await prepareShopifyOrderRecovery(command.arg ?? "");
    if (typeof recovery.error === "string") {
      await sendMessage(env.TG_BOT_TOKEN!, chatId, recovery.error);
      return;
    }
    await sendMessage(env.TG_BOT_TOKEN!, chatId, {
      text: [
        "Аварийное восстановление Shopify-заказа:",
        `Checkout: ${recovery.checkoutSessionId}`,
        `Источник: ${recovery.sourceIdentifier ?? "—"}`,
        `Подтверждённая оплата: ${recovery.amount}`,
      ].join("\n"),
      replyMarkup: telegramConfirmationKeyboard("recover-shopify-order", recovery.checkoutSessionId),
    });
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
