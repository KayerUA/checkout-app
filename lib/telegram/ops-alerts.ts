import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logWithCorrelation } from "@/lib/logger";
import {
  paymentWithoutOrderAlertMessage,
  telegramApi,
  telegramGroupChatIds,
} from "@/lib/telegram/bot";

const PAYMENT_WITHOUT_ORDER_EVENT = "payment_without_shopify_order";
const DUPLICATE_ONLINE_PAYMENT_EVENT = "duplicate_online_payment";

export type PaymentWithoutOrderAlert = {
  provider: string;
  amount: number;
  currency: string;
  checkoutSessionId: string;
  sourceIdentifier?: string | null;
  providerReference?: string | null;
  retryQueued?: boolean;
};

export async function notifyPaymentWithoutOrder(input: PaymentWithoutOrderAlert) {
  const alreadySent = await prisma.automationLog.findFirst({
    where: {
      eventType: PAYMENT_WITHOUT_ORDER_EVENT,
      step: input.checkoutSessionId,
      status: "ALERT_SENT",
    },
    select: { id: true },
  });
  if (alreadySent) return { sent: 0, deduplicated: true };

  const env = getEnv();
  const chatIds = telegramGroupChatIds(env.TG_ALLOWED_CHAT_IDS);
  if (!env.TG_BOT_TOKEN || !chatIds.length) {
    logWithCorrelation(
      "warn",
      "Telegram payment-without-order alert is not configured",
      { checkoutSessionId: input.checkoutSessionId },
      { groupChatCount: chatIds.length }
    );
    return { sent: 0, deduplicated: false };
  }

  const text = paymentWithoutOrderAlertMessage(input);
  const results = await Promise.allSettled(
    chatIds.map((chatId) =>
      telegramApi(env.TG_BOT_TOKEN!, "sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      })
    )
  );
  const sent = results.filter((result) => result.status === "fulfilled").length;

  if (sent > 0) {
    await prisma.automationLog.create({
      data: {
        eventType: PAYMENT_WITHOUT_ORDER_EVENT,
        step: input.checkoutSessionId,
        status: "ALERT_SENT",
        message: `Telegram alert sent to ${sent} group chat(s)`,
        metadata: {
          provider: input.provider,
          amount: input.amount,
          currency: input.currency,
          sourceIdentifier: input.sourceIdentifier ?? null,
          providerReference: input.providerReference ?? null,
          retryQueued: input.retryQueued ?? false,
        },
      },
    });
  }

  if (sent !== chatIds.length) {
    logWithCorrelation(
      "error",
      "Telegram payment-without-order alert delivery failed",
      { checkoutSessionId: input.checkoutSessionId },
      { sent, expected: chatIds.length }
    );
  }

  return { sent, deduplicated: false };
}

export async function notifyDuplicateOnlinePayment(input: PaymentWithoutOrderAlert) {
  const step = input.providerReference || input.checkoutSessionId;
  const alreadySent = await prisma.automationLog.findFirst({
    where: {
      eventType: DUPLICATE_ONLINE_PAYMENT_EVENT,
      step,
      status: "ALERT_SENT",
    },
    select: { id: true },
  });
  if (alreadySent) return { sent: 0, deduplicated: true };

  const env = getEnv();
  const chatIds = telegramGroupChatIds(env.TG_ALLOWED_CHAT_IDS);
  if (!env.TG_BOT_TOKEN || !chatIds.length) {
    return { sent: 0, deduplicated: false };
  }

  const amount = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(input.amount / 100);
  const text = [
    "🚨 Повторна онлайн-оплата вже оплаченого замовлення",
    `Провайдер: ${input.provider}`,
    `Сума: ${amount} ${input.currency}`,
    `Джерело: ${input.sourceIdentifier || "—"}`,
    `Reference: ${input.providerReference || "—"}`,
    "Не створюю друге замовлення. Потрібна ручна перевірка та повернення дубля.",
  ].join("\n");
  const results = await Promise.allSettled(
    chatIds.map((chatId) =>
      telegramApi(env.TG_BOT_TOKEN!, "sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      })
    )
  );
  const sent = results.filter((result) => result.status === "fulfilled").length;
  if (sent > 0) {
    await prisma.automationLog.create({
      data: {
        eventType: DUPLICATE_ONLINE_PAYMENT_EVENT,
        step,
        status: "ALERT_SENT",
        message: `Telegram duplicate-payment alert sent to ${sent} group chat(s)`,
        metadata: {
          provider: input.provider,
          amount: input.amount,
          currency: input.currency,
          sourceIdentifier: input.sourceIdentifier ?? null,
          providerReference: input.providerReference ?? null,
        },
      },
    });
  }
  return { sent, deduplicated: false };
}

export async function alertExistingPaidSessionsWithoutOrders(take = 20) {
  const sessions = await prisma.checkoutSession.findMany({
    where: {
      status: "PAID",
      paymentAttempts: { some: { status: "PAID" } },
      OR: [
        { orderLink: { is: null } },
        { orderLink: { is: { shopifyOrderGid: null } } },
      ],
    },
    include: {
      paymentAttempts: {
        where: { status: "PAID" },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    take,
  });

  let alerted = 0;
  for (const session of sessions) {
    const attempt = session.paymentAttempts[0];
    if (!attempt) continue;
    const result = await notifyPaymentWithoutOrder({
      provider: attempt.provider,
      amount: attempt.amount,
      currency: session.currency,
      checkoutSessionId: session.id,
      sourceIdentifier: session.sourceIdentifier,
      providerReference: attempt.providerReference,
      retryQueued: false,
    });
    if (result.sent > 0) alerted += 1;
  }

  return { checked: sessions.length, alerted };
}

export async function notifyExternalOpsAlert(input: {
  source: string;
  eventType: string;
  severity?: string;
  shopifyOrderId?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  /** Omit the time window for a transaction-specific alert that must be sent once. */
  dedupeWindowHours?: number | null;
}) {
  const step = `${input.source}:${input.eventType}:${input.shopifyOrderId || "global"}`;
  const dedupeWindowHours = input.dedupeWindowHours === undefined
    ? 12
    : input.dedupeWindowHours;
  const alreadySent = await prisma.automationLog.findFirst({
    where: {
      eventType: "external_ops_alert",
      step,
      status: "ALERT_SENT",
      ...(dedupeWindowHours === null
        ? {}
        : { createdAt: { gte: new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000) } }),
    },
    select: { id: true },
  });
  if (alreadySent) return { sent: 0, deduplicated: true };

  const env = getEnv();
  const chatIds = telegramGroupChatIds(env.TG_ALLOWED_CHAT_IDS);
  if (!env.TG_BOT_TOKEN || !chatIds.length) return { sent: 0, deduplicated: false };
  const icon = input.severity === "info" ? "✅" : input.severity === "warning" ? "⚠️" : "🚨";
  const text = [
    `${icon} ${input.source}: ${input.eventType}`,
    input.shopifyOrderId ? `Shopify order ID: ${input.shopifyOrderId}` : null,
    input.message.replace(/\s+/g, " ").slice(0, 1200),
  ].filter(Boolean).join("\n");
  const replyMarkup = input.replyMarkup ?? (input.shopifyOrderId
    ? {
        inline_keyboard: [
          [{ text: "Открыть заказ", callback_data: `order|${input.shopifyOrderId}` }],
          [{ text: "📄 Скачать счёт", callback_data: `send-invoice|${input.shopifyOrderId}` }],
        ],
      }
    : undefined);
  const results = await Promise.allSettled(
    chatIds.map((chatId) =>
      telegramApi(env.TG_BOT_TOKEN!, "sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      })
    )
  );
  const sent = results.filter((result) => result.status === "fulfilled").length;
  if (sent) {
    await prisma.automationLog.create({
      data: {
        shopifyOrderId: input.shopifyOrderId || undefined,
        eventType: "external_ops_alert",
        step,
        status: "ALERT_SENT",
        message: `Telegram ops alert sent to ${sent} chat(s)`,
        metadata: {
          source: input.source,
          sourceEventType: input.eventType,
          severity: input.severity ?? "error",
          ...(input.metadata ?? {}),
        },
      },
    });
  }
  return { sent, deduplicated: false };
}
