import Redis from "ioredis";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getQueue, QUEUE_NAMES, WORKER_HEARTBEAT_KEY } from "@/lib/queue";
import { findShopifyOpsOrder, shopifyAdminOrderUrl, type ShopifyOpsOrder } from "@/lib/shopify/order-ops";
import {
  getDiloshopHealth,
  getDiloshopIssues,
  getDiloshopMappingGaps,
  getDiloshopOrder,
  getDiloshopSku,
  type DiloshopOrderState,
} from "@/lib/telegram/diloshop-client";
import { telegramMenuKeyboard } from "@/lib/telegram/bot";
import { createShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { checkoutFulfillmentIssues } from "@/lib/checkout/fulfillment-validation";

export type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{
    text: string;
    url?: string;
    callback_data?: string;
  }>>;
};

export type TelegramOpsMessage = {
  text: string;
  replyMarkup?: TelegramInlineKeyboard;
};

async function isResolvedNovaPoshtaFallbackError(error: {
  eventType: string | null;
  step: string | null;
  shopifyOrderId: string | null;
}) {
  if (
    error.eventType !== "diloshop/nova-poshta" ||
    error.step !== "fallback_dispatch" ||
    !error.shopifyOrderId
  ) {
    return false;
  }
  const order = await findShopifyOpsOrder(error.shopifyOrderId).catch(() => null);
  return Boolean(order?.fulfillments?.some((fulfillment) =>
    fulfillment.trackingInfo?.some((tracking) => Boolean(tracking.number))
  ));
}

async function isResolvedMatchedPaymentError(error: {
  step: string | null;
  shopifyOrderId: string | null;
  metadata: unknown;
}) {
  if (error.step !== "matched_payment_finalize" || !error.shopifyOrderId) return false;
  const metadata = error.metadata && typeof error.metadata === "object" && !Array.isArray(error.metadata)
    ? error.metadata as Record<string, unknown>
    : {};
  const transactionId = typeof metadata.transactionId === "string" ? metadata.transactionId : null;
  const [order, payment] = await Promise.all([
    prisma.b2BOrder.findUnique({
      where: { shopifyOrderId: error.shopifyOrderId },
      select: { paymentStatus: true, status: true },
    }),
    transactionId
      ? prisma.bankPayment.findUnique({
          where: { transactionId },
          select: { status: true, matchedShopifyOrderId: true },
        })
      : null,
  ]);
  return Boolean(
    order?.paymentStatus === "PAID" &&
    ["PAYMENT_MATCHED", "PAYMENT_CONFIRMED", "DOCS_SENT", "READY_TO_FULFILL_AFTER_BANK_PAYMENT"].includes(order.status) &&
    payment?.status === "MATCHED" &&
    payment.matchedShopifyOrderId === error.shopifyOrderId
  );
}

async function isResolvedShopifyRecoveryError(error: {
  step: string | null;
  shopifyOrderId: string | null;
}) {
  if (error.step !== "action:recover-shopify-order" || !error.shopifyOrderId) {
    return false;
  }
  // Telegram audit historically stored the checkout session ID in
  // shopifyOrderId for this action. Keep the failed attempt in history, but do
  // not show it as an active issue once the checkout has a Shopify order link.
  const session = await prisma.checkoutSession.findUnique({
    where: { id: error.shopifyOrderId },
    select: {
      orderLink: {
        select: { shopifyOrderGid: true },
      },
    },
  });
  return Boolean(session?.orderLink?.shopifyOrderGid);
}

export async function prepareShopifyOrderRecovery(reference: string) {
  const value = reference.trim();
  if (!value) return { error: "Укажите Checkout ID или source identifier." } as const;
  const session = await prisma.checkoutSession.findFirst({
    where: {
      OR: [{ id: value }, { sourceIdentifier: value }],
    },
    include: { paymentAttempts: { orderBy: { createdAt: "desc" } }, orderLink: true },
  });
  if (!session) return { error: "Checkout не найден." } as const;
  if (session.orderLink?.shopifyOrderGid) {
    return { error: `Shopify-заказ уже существует: ${session.orderLink.shopifyOrderName ?? session.orderLink.shopifyOrderGid}.` } as const;
  }
  const paid = session.paymentAttempts.find((attempt) => attempt.status === "PAID");
  if (!paid) return { error: "У checkout нет подтверждённой оплаты — восстановление запрещено." } as const;
  const issues = checkoutFulfillmentIssues(session);
  if (issues.length) {
    return { error: `Сначала исправьте данные получателя: ${issues.join(", ")}.` } as const;
  }
  return {
    checkoutSessionId: session.id,
    sourceIdentifier: session.sourceIdentifier,
    amount: cents(paid.amount, session.currency),
  } as const;
}

export async function recoverShopifyOrderFromCheckout(checkoutSessionId: string) {
  const order = await createShopifyOrderIdempotent(checkoutSessionId);
  return {
    checkoutSessionId,
    shopifyOrderGid: order.shopifyOrderGid,
    shopifyOrderName: order.shopifyOrderName,
    status: order.orderStatus,
  };
}

function money(value: number | string | null | undefined, currency = "UAH") {
  const amount = typeof value === "string" ? Number(value) : Number(value ?? 0);
  return `${new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)} ${currency}`;
}

function cents(value: number | null | undefined, currency = "UAH") {
  return money((value ?? 0) / 100, currency);
}

function scalar(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function dilovodOrderReference(mapping: Record<string, unknown> | null | undefined) {
  if (!mapping) return "";
  return (
    scalar(mapping.dilovod_document_number) ||
    scalar(mapping.sale_order_id) ||
    scalar(mapping.dilovod_sale_order_id)
  ).trim();
}

function marker(status: string | null | undefined) {
  const normalized = String(status ?? "").toUpperCase();
  if (["PAID", "SUCCESS", "DONE", "COMPLETED", "OK", "CREATED", "POSTED"].includes(normalized)) {
    return "✅";
  }
  if (["FAILED", "ERROR", "DEAD", "CANCELLED", "VOIDED"].includes(normalized)) return "❌";
  return "⚠️";
}

export function normalizeOrderReference(reference: string) {
  const raw = reference.trim();
  if (/^\d{9,}$/.test(raw)) return { input: raw, name: null, numericId: raw };
  const digits = raw.toUpperCase().replace(/^#/, "").replace(/^UA[\s_-]*/, "").replace(/\D/g, "");
  if (!digits) return { input: raw, name: null, numericId: null };
  return { input: raw, name: `#UA${digits}`, numericId: null };
}

async function localOrder(reference: ReturnType<typeof normalizeOrderReference>) {
  const orderWhere = reference.numericId
    ? {
        OR: [
          { shopifyOrderGid: `gid://shopify/Order/${reference.numericId}` },
          { shopifyOrderName: reference.input },
        ],
      }
    : {
        OR: [
          { shopifyOrderName: { equals: reference.name ?? reference.input, mode: "insensitive" as const } },
          { shopifyOrderName: { equals: (reference.name ?? "").replace(/^#/, ""), mode: "insensitive" as const } },
        ],
      };
  const orderLink = await prisma.orderLink.findFirst({
    where: orderWhere,
    include: {
      fiscalReceipt: true,
      checkoutSession: {
        include: {
          merchant: true,
          paymentAttempts: { orderBy: { createdAt: "desc" } },
          lines: true,
        },
      },
    },
  });
  const b2bWhere = reference.numericId
    ? { shopifyOrderId: reference.numericId }
    : { shopifyOrderName: { equals: reference.name ?? reference.input, mode: "insensitive" as const } };
  const b2bOrder = await prisma.b2BOrder.findFirst({ where: b2bWhere });
  return { orderLink, b2bOrder };
}

function orderIdFromGid(gid?: string | null) {
  return gid?.match(/\/Order\/(\d+)$/)?.[1] ?? null;
}

function successfulShopifyAmount(order: ShopifyOpsOrder | null) {
  return (order?.transactions ?? [])
    .filter((transaction) =>
      ["SALE", "CAPTURE"].includes(transaction.kind) && transaction.status === "SUCCESS"
    )
    .reduce((sum, transaction) => sum + Number(transaction.amountSet?.shopMoney?.amount ?? 0), 0);
}

function latestJob(state: DiloshopOrderState | null) {
  return state?.jobs?.[0] ?? null;
}

export async function buildOrderCard(referenceText: string, options?: { admin?: boolean }) {
  const reference = normalizeOrderReference(referenceText);
  if (!reference.name && !reference.numericId) {
    return { text: "Укажите заказ: /order UA1183" } satisfies TelegramOpsMessage;
  }

  let local = await localOrder(reference);
  let shopify = await findShopifyOpsOrder(
    reference.numericId ?? reference.name ?? reference.input
  ).catch(() => null);
  const shopifyOrderId =
    shopify?.legacyResourceId ||
    orderIdFromGid(local.orderLink?.shopifyOrderGid) ||
    local.b2bOrder?.shopifyOrderId ||
    reference.numericId;
  if (!local.orderLink && !local.b2bOrder && shopifyOrderId) {
    local = await localOrder({ input: shopifyOrderId, name: null, numericId: shopifyOrderId });
  }
  if (!shopify && shopifyOrderId) {
    shopify = await findShopifyOpsOrder(shopifyOrderId).catch(() => null);
  }
  if (!shopify && !local.orderLink && !local.b2bOrder) {
    return { text: `Заказ ${reference.name ?? reference.input} не найден.` } satisfies TelegramOpsMessage;
  }

  const [diloshop, documents, bankPayments, automation] = await Promise.all([
    shopifyOrderId ? getDiloshopOrder(shopifyOrderId).catch(() => null) : null,
    shopifyOrderId
      ? prisma.b2BDocument.findMany({ where: { shopifyOrderId }, orderBy: { createdAt: "desc" } })
      : [],
    shopifyOrderId
      ? prisma.bankPayment.findMany({
          where: { matchedShopifyOrderId: shopifyOrderId },
          orderBy: { transactionDate: "desc" },
        })
      : [],
    shopifyOrderId
      ? prisma.automationLog.findMany({
          where: { shopifyOrderId },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [],
  ]);

  const session = local.orderLink?.checkoutSession;
  const paidAttempt = session?.paymentAttempts.find((attempt) => attempt.status === "PAID");
  const total = shopify?.currentTotalPriceSet?.shopMoney ?? shopify?.totalPriceSet?.shopMoney;
  const customer = shopify?.customer?.displayName ||
    [session?.buyerFirstName, session?.buyerLastName].filter(Boolean).join(" ") ||
    local.b2bOrder?.fopName || "Клиент не указан";
  const mapping = diloshop?.mapping;
  const dilovodOrder = dilovodOrderReference(mapping);
  const hasDilovodOrder = Boolean(dilovodOrder);
  const job = latestJob(diloshop);
  const shipment = diloshop?.np_shipment;
  const ttn = scalar(shipment?.ttn) || shopify?.fulfillments?.flatMap((f) => f.trackingInfo ?? [])[0]?.number || "";
  const npStatus = scalar(shipment?.np_status_text) || (ttn ? "ТТН создана" : "не запускалась");
  const fiscal = local.orderLink?.fiscalReceipt;
  const paidAmount = local.b2bOrder ? Number(local.b2bOrder.paidAmount) : successfulShopifyAmount(shopify);
  const expectedAmount = local.b2bOrder
    ? Number(local.b2bOrder.expectedAmount ?? local.b2bOrder.orderTotalAmount ?? 0)
    : Number(total?.amount ?? 0);

  const lines = [
    `${shopify?.name ?? local.orderLink?.shopifyOrderName ?? local.b2bOrder?.shopifyOrderName ?? reference.name} · ${customer}`,
    "",
    `Checkout       ${session ? marker(session.status) : "—"} ${session?.status ?? "не найден"}`,
    `Оплата         ${paidAttempt ? "✅" : marker(shopify?.displayFinancialStatus)} ${paidAttempt ? `${paidAttempt.provider} · ${cents(paidAttempt.amount, session?.currency)}` : `${shopify?.displayFinancialStatus ?? local.b2bOrder?.paymentStatus ?? "нет данных"} · ${money(paidAmount, total?.currencyCode ?? "UAH")}`}`,
    `Shopify        ${shopify ? marker(shopify.displayFinancialStatus) : "—"} ${shopify ? `${shopify.displayFinancialStatus} · ${shopify.displayFulfillmentStatus}` : "не найден"}`,
    `Dilovod        ${hasDilovodOrder ? "✅" : job?.status === "dead" ? "❌" : "⚠️"} ${hasDilovodOrder ? `${dilovodOrder}${Number(mapping?.dilovod_posted) ? " · POSTED" : ""}` : job ? `${job.status} · попыток ${job.attempts}` : "saleOrder не найден"}`,
    `Нова Пошта     ${ttn ? "✅" : scalar(shipment?.create_error) ? "❌" : "—"} ${ttn ? `${ttn} · ${npStatus}` : scalar(shipment?.create_error) || npStatus}`,
    `Фискализация   ${fiscal ? marker(fiscal.status) : "—"} ${fiscal?.status ?? "не используется"}`,
    `cashIn          ${diloshop?.cash_in?.length ? "✅" : "—"} ${diloshop?.cash_in?.length ? `${diloshop.cash_in.length} подтвержд. транзакц.` : "не найден"}`,
  ];

  if (shopify?.refunds?.length || diloshop?.sale_returns?.length) {
    const refunded = (shopify?.refunds ?? []).reduce(
      (sum, refund) => sum + Number(refund.totalRefundedSet?.shopMoney?.amount ?? 0),
      0
    );
    lines.push(
      `Возвраты        ${shopify?.refunds?.length ? "✅" : "⚠️"} Shopify ${shopify?.refunds?.length ?? 0} · ${money(refunded, total?.currencyCode ?? "UAH")} · Dilovod saleReturn ${diloshop?.sale_returns?.length ?? 0}`
    );
  }

  if (local.b2bOrder) {
    lines.push(
      `B2B             ${marker(local.b2bOrder.paymentStatus)} ${local.b2bOrder.paymentStatus}`,
      `Суммы           ${money(paidAmount)} / ${money(expectedAmount)} · остаток ${money(Number(local.b2bOrder.remainingAmount ?? Math.max(expectedAmount - paidAmount, 0)))}`,
      `Документы       ${documents.length ? documents.map((doc) => `${doc.type}:${doc.status}`).join(", ") : "нет"}`,
      `Банк            ${bankPayments.length ? `${bankPayments.length} транзакц.` : "транзакций нет"}`
    );
  }

  const problems: string[] = [];
  if (paidAttempt && !shopify) problems.push("оплата подтверждена, но Shopify-заказ отсутствует");
  if (shopify?.fullyPaid && !hasDilovodOrder) problems.push("оплаченный заказ не дошёл в Dilovod");
  if (job?.status === "dead") problems.push(`Dilovod job dead: ${job.last_error ?? "без текста ошибки"}`);
  if (scalar(shipment?.create_error)) problems.push(`НП: ${scalar(shipment?.create_error)}`);
  if (local.b2bOrder?.paymentStatus === "PARTIALLY_PAID") problems.push("частичная оплата — fulfillment заблокирован");
  const latestError = automation.find((row) => row.status === "ERROR");
  if (latestError?.errorMessage) problems.push(latestError.errorMessage);
  if (problems.length) lines.push("", `Проблема: ${problems.join("; ").slice(0, 900)}`);

  const inline_keyboard: TelegramInlineKeyboard["inline_keyboard"] = [];
  const links: TelegramInlineKeyboard["inline_keyboard"][number] = [];
  if (shopifyOrderId) {
    const url = shopifyAdminOrderUrl(shopifyOrderId);
    if (url) links.push({ text: "Shopify Admin", url });
  }
  if (ttn) links.push({ text: "Трекинг НП", url: `https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(ttn)}` });
  if (links.length) inline_keyboard.push(links);

  const invoiceDoc = documents.find((doc) => doc.type === "invoice" && doc.number);
  if (shopifyOrderId && invoiceDoc) {
    inline_keyboard.push([
      {
        text: `📄 Скачать счёт ${invoiceDoc.number}`,
        callback_data: `send-invoice|${shopifyOrderId}`,
      },
    ]);
  }

  if (shopifyOrderId) {
    inline_keyboard.push([{ text: "🔄 Обновить карточку", callback_data: `order|${shopifyOrderId}` }]);
    if (options?.admin) {
      inline_keyboard.push([
        { text: "Повторить Dilovod", callback_data: `confirm|retry-dilovod|${shopifyOrderId}` },
        { text: "Повторить НП", callback_data: `confirm|retry-np|${shopifyOrderId}` },
      ]);
      if (ttn) {
        inline_keyboard.push([{ text: "Обновить НП", callback_data: `confirm|refresh-np|${shopifyOrderId}` }]);
      }
    }
  }
  inline_keyboard.push(telegramMenuKeyboard());
  return { text: lines.join("\n"), replyMarkup: { inline_keyboard } } satisfies TelegramOpsMessage;
}

export async function buildIssuesSummary(hours = 24, filter?: string): Promise<TelegramOpsMessage> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const [paidWithoutOrder, unmatched, partial, fiscalFailed, automationErrors, diloshop] = await Promise.all([
    prisma.checkoutSession.findMany({
      where: {
        status: "PAID",
        updatedAt: { gte: since },
        OR: [{ orderLink: { is: null } }, { orderLink: { is: { shopifyOrderGid: null } } }],
      },
      take: 20,
    }),
    prisma.bankPayment.findMany({
      where: { status: { in: ["NEW", "NEEDS_REVIEW"] }, transactionDate: { gte: since } },
      orderBy: { transactionDate: "desc" },
      take: 20,
    }),
    prisma.b2BOrder.findMany({
      where: { paymentStatus: { in: ["PARTIALLY_PAID", "PAID_WITH_OVERPAYMENT"] }, updatedAt: { gte: since } },
      take: 20,
    }),
    prisma.fiscalReceipt.findMany({ where: { status: "FAILED", updatedAt: { gte: since } }, take: 20 }),
    prisma.automationLog.findMany({
      where: { status: "ERROR", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    getDiloshopIssues(hours, 20).catch(() => null),
  ]);
  const resolvedAutomationErrors = await Promise.all(
    automationErrors.map(async (error) =>
      (await isResolvedNovaPoshtaFallbackError(error)) ||
      (await isResolvedMatchedPaymentError(error)) ||
      (await isResolvedShopifyRecoveryError(error))
    )
  );
  const activeAutomationErrors = automationErrors.filter((_, index) => !resolvedAutomationErrors[index]);
  const errorOrderIds = Array.from(new Set(
    activeAutomationErrors.map((error) => error.shopifyOrderId).filter(Boolean)
  )) as string[];
  const errorOrders = errorOrderIds.length
    ? await prisma.b2BOrder.findMany({
        where: { shopifyOrderId: { in: errorOrderIds } },
        select: { shopifyOrderId: true, shopifyOrderName: true },
      })
    : [];
  const errorOrderNames = new Map(
    errorOrders.map((order) => [order.shopifyOrderId, order.shopifyOrderName ?? order.shopifyOrderId])
  );
  const show = (name: string) => !filter || filter === "all" || filter === name;
  const lines = [`Проблемы за ${hours} ч:`];
  if (show("payments")) {
    lines.push(`Оплачено без Shopify: ${paidWithoutOrder.length}`, `Банк без матча/review: ${unmatched.length}`);
    if (unmatched.length) {
      lines.push(
        "",
        "Банковские платежи без матча:",
        ...unmatched.slice(0, 5).map((payment) => [
          `• ${money(Number(payment.amount), payment.currency)}`,
          payment.payerName ?? "плательщик неизвестен",
          payment.status,
          `ref …${payment.transactionId.slice(-8)}`,
          payment.paymentDescription
            ? payment.paymentDescription.replace(/\s+/g, " ").slice(0, 90)
            : null,
        ].filter(Boolean).join(" · "))
      );
    }
  }
  if (show("b2b")) lines.push(`B2B partial/overpayment: ${partial.length}`);
  if (show("fiscal")) lines.push(`Фискализация failed: ${fiscalFailed.length}`);
  if (show("dilovod")) {
    lines.push(
      `Diloshop dead: ${diloshop?.queue?.dead ?? 0}`,
      `Diloshop pending: ${diloshop?.queue?.pending ?? 0}`,
      `Diloshop sync errors: ${diloshop?.sync_issues?.length ?? "недоступен"}`
    );
  }
  if (show("np")) lines.push(`НП errors: ${diloshop?.np_issues?.length ?? "недоступен"}`);
  lines.push(`Checkout automation errors: ${activeAutomationErrors.length}`);
  const orders = Array.from(
    new Set(partial.map((row) => row.shopifyOrderName).filter(Boolean))
  ).slice(0, 8) as string[];
  if (activeAutomationErrors.length) {
    lines.push("", ...activeAutomationErrors.slice(0, 5).map((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const transactionId = typeof metadata.transactionId === "string" ? metadata.transactionId : null;
      const relation = [
        row.shopifyOrderId ? errorOrderNames.get(row.shopifyOrderId) ?? row.shopifyOrderId : null,
        transactionId ? `ref …${transactionId.slice(-8)}` : null,
      ].filter(Boolean).join(" · ");
      return `• ${row.step ?? row.eventType}${relation ? ` · ${relation}` : ""}: ${(row.errorMessage ?? row.message ?? "ошибка").slice(0, 180)}`;
    }));
  }
  const relatedOrders = Array.from(new Set([
    ...orders,
    ...errorOrders.map((order) => order.shopifyOrderName).filter(Boolean),
  ])).slice(0, 8) as string[];
  const inline_keyboard = relatedOrders.map((order) => [
    { text: `Открыть ${order}`, callback_data: `lookup|${order.replace(/^#/, "")}` },
  ]);
  if (unmatched.length) {
    inline_keyboard.push([{
      text: `🧾 Разобрать платежи (${unmatched.length})`,
      callback_data: "bank_review",
    }]);
  }
  inline_keyboard.push([{ text: "🔄 Обновить", callback_data: `issues|${hours}|${filter ?? "all"}` }]);
  inline_keyboard.push(telegramMenuKeyboard());
  return { text: lines.join("\n"), replyMarkup: { inline_keyboard } };
}

export async function buildTodaySummary(): Promise<TelegramOpsMessage> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [sessions, abandoned, paid, orders, b2b, unmatched, diloshop] = await Promise.all([
    prisma.checkoutSession.count({ where: { createdAt: { gte: since } } }),
    prisma.checkoutSession.count({ where: { status: "ABANDONED", abandonedAt: { gte: since } } }),
    prisma.paymentAttempt.findMany({ where: { status: "PAID", updatedAt: { gte: since } } }),
    prisma.orderLink.count({ where: { createdAt: { gte: since }, shopifyOrderGid: { not: null } } }),
    prisma.b2BOrder.groupBy({ by: ["paymentStatus"], where: { updatedAt: { gte: since } }, _count: true }),
    prisma.bankPayment.count({ where: { transactionDate: { gte: since }, status: { in: ["NEW", "NEEDS_REVIEW"] } } }),
    getDiloshopIssues(24, 20).catch(() => null),
  ]);
  const paidTotal = paid.reduce((sum, row) => sum + row.amount, 0);
  const b2bText = b2b.map((row) => `${row.paymentStatus}:${row._count}`).join(", ") || "нет";
  return {
    text: [
      "Сегодня:",
      `Checkout начато: ${sessions}`,
      `Брошено с контактами: ${abandoned}`,
      `Онлайн оплачено: ${paid.length} · ${cents(paidTotal)}`,
      `Shopify создано: ${orders}`,
      `B2B: ${b2bText}`,
      `Банк без матча/review: ${unmatched}`,
      `Diloshop queue: pending ${diloshop?.queue?.pending ?? "—"} · dead ${diloshop?.queue?.dead ?? "—"}`,
      `НП errors: ${diloshop?.np_issues?.length ?? "—"}`,
    ].join("\n"),
    replyMarkup: { inline_keyboard: [[{ text: "Проблемы", callback_data: "issues|24|all" }], telegramMenuKeyboard()] },
  };
}

export async function buildHealthSummary(): Promise<TelegramOpsMessage> {
  const env = getEnv();
  const checks: string[] = [];
  await prisma.$queryRaw`SELECT 1`;
  checks.push("Checkout DB   ✅ ok");
  let redis: Redis | null = null;
  try {
    redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500 });
    await redis.connect();
    await redis.ping();
    const heartbeat = await redis.get(WORKER_HEARTBEAT_KEY);
    checks.push("Redis         ✅ ok", `Worker        ${heartbeat ? "✅ heartbeat" : "⚠️ heartbeat отсутствует"}`);
  } catch {
    checks.push("Redis         ❌ недоступен", "Worker        ⚠️ не проверен");
  } finally {
    redis?.disconnect();
  }
  const diloshop = await getDiloshopHealth().catch(() => null);
  checks.push(
    `Diloshop      ${diloshop?.ok ? "✅ ok" : env.DILOSHOP_API_URL ? "❌ недоступен/не авторизован" : "⚠️ не настроен"}`,
    `Dilo queue    ${diloshop ? `pending ${diloshop.queue.pending ?? 0} · dead ${diloshop.queue.dead ?? 0}` : "—"}`
  );
  return {
    text: ["Состояние системы:", ...checks].join("\n"),
    replyMarkup: { inline_keyboard: [[{ text: "🔄 Обновить", callback_data: "health" }], telegramMenuKeyboard()] },
  };
}

export async function buildQueueSummary(): Promise<TelegramOpsMessage> {
  let checkout = "недоступна";
  try {
    const counts = await Promise.all(
      [QUEUE_NAMES.ORDERS, QUEUE_NAMES.PAYMENTS, QUEUE_NAMES.FISCAL].map(async (name) => ({
        name,
        counts: await getQueue(name).getJobCounts("waiting", "active", "failed", "delayed"),
      }))
    );
    checkout = counts.map((row) => `${row.name}: w${row.counts.waiting}/a${row.counts.active}/f${row.counts.failed}`).join("\n");
  } catch {
    // Health output below is still useful when Redis is unavailable.
  }
  const issues = await getDiloshopIssues(72, 10).catch(() => null);
  const oldest = issues?.jobs?.slice().sort((a, b) => a.created_at - b.created_at)[0];
  return {
    text: [
      "Очереди Checkout:",
      checkout,
      "",
      "Очередь Diloshop:",
      `pending ${issues?.queue?.pending ?? "—"} · processing ${issues?.queue?.processing ?? "—"} · dead ${issues?.queue?.dead ?? "—"}`,
      oldest ? `Старейшая: job ${oldest.id} · ${oldest.status} · ${oldest.last_error ?? "без ошибки"}` : "Активных проблем не найдено.",
    ].join("\n"),
    replyMarkup: { inline_keyboard: [[{ text: "🔄 Обновить", callback_data: "queue" }], telegramMenuKeyboard()] },
  };
}

export async function buildUnmatchedSummary(days = 7): Promise<TelegramOpsMessage> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.bankPayment.findMany({
    where: { transactionDate: { gte: since }, status: { in: ["NEW", "NEEDS_REVIEW"] } },
    orderBy: { transactionDate: "desc" },
    take: 30,
  });
  const lines = [`Банковские оплаты без надёжного матча за ${days} дн.: ${rows.length}`];
  rows.slice(0, 15).forEach((row) => {
    lines.push(`• ${money(Number(row.amount), row.currency)} · ${row.payerName ?? "плательщик неизвестен"} · ${row.status} · ref …${row.transactionId.slice(-8)}`);
  });
  if (!rows.length) lines.push("Новых не обнаружено.");
  return { text: lines.join("\n") };
}

export async function buildSkuSummary(sku: string): Promise<TelegramOpsMessage> {
  if (!sku.trim()) return { text: "Укажите SKU: /sku LUX-COY" };
  const state = await getDiloshopSku(sku.trim()).catch(() => null);
  if (!state) return { text: "Diloshop недоступен или Bot API ещё не настроен." };
  const mapping = state.mapping;
  return {
    text: mapping
      ? [
          `SKU ${state.sku}`,
          `Dilovod good: ${scalar(mapping.dilovod_good_id) || "—"}`,
          `Shopify variant: ${scalar(mapping.shopify_variant_id) || "—"}`,
          `Inventory item: ${scalar(mapping.shopify_inventory_item_id) || "—"}`,
          `Последних sync-записей: ${state.sync_log.length}`,
        ].join("\n")
      : `SKU ${state.sku}: mapping Shopify ↔ Dilovod не найден.`,
  };
}

export async function buildMappingGapsSummary(): Promise<TelegramOpsMessage> {
  const state = await getDiloshopMappingGaps().catch(() => null);
  if (!state) return { text: "Diloshop недоступен или Bot API ещё не настроен." };
  return {
    text: [
      "Mapping Shopify ↔ Dilovod:",
      `Строк: ${state.mapping.total_rows ?? 0}`,
      `Полностью связаны: ${state.mapping.fully_linked_variant_and_inventory ?? 0}`,
      `Без Shopify variant: ${state.mapping.missing_shopify_variant_id ?? 0}`,
      `Без inventory item: ${state.mapping.missing_inventory_item_id ?? 0}`,
      `Уникальных Shopify variants: ${state.distinct.distinct_shopify_variants_linked_to_dilovod_good ?? 0}`,
      `Уникальных Dilovod goods: ${state.distinct.distinct_dilovod_good_ids_linked_to_shopify_variant ?? 0}`,
    ].join("\n"),
  };
}

function maskContact(value: string | null | undefined) {
  if (!value) return "—";
  if (value.includes("@")) {
    const [name, domain] = value.split("@", 2);
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

export async function buildCustomerSummary(query: string, reveal: boolean): Promise<TelegramOpsMessage> {
  const value = query.trim();
  if (!value) return { text: "Укажите телефон или email: /customer +380…" };
  const sessions = await prisma.checkoutSession.findMany({
    where: {
      OR: [
        { buyerEmail: { contains: value, mode: "insensitive" } },
        { buyerPhone: { contains: value } },
      ],
    },
    include: { orderLink: true, lines: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  if (!sessions.length) return { text: "Клиент и checkout не найдены." };
  const first = sessions[0];
  const lines = [
    `${[first.buyerFirstName, first.buyerLastName].filter(Boolean).join(" ") || "Без имени"}`,
    `Телефон: ${reveal ? first.buyerPhone ?? "—" : maskContact(first.buyerPhone)}`,
    `Email: ${reveal ? first.buyerEmail ?? "—" : maskContact(first.buyerEmail)}`,
    `Checkout/заказов: ${sessions.length}`,
    ...sessions.map((row) => `• ${row.orderLink?.shopifyOrderName ?? row.sourceIdentifier ?? row.publicToken} · ${row.status} · ${cents(row.totalAmount, row.currency)}`),
  ];
  const inline_keyboard = sessions
    .filter((row) => row.orderLink?.shopifyOrderName)
    .slice(0, 8)
    .map((row) => [{ text: row.orderLink!.shopifyOrderName!, callback_data: `lookup|${row.orderLink!.shopifyOrderName!.replace(/^#/, "")}` }]);
  return { text: lines.join("\n"), replyMarkup: { inline_keyboard } };
}

export async function buildWebhooksSummary(hours = 24): Promise<TelegramOpsMessage> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const [processed, deliveries] = await Promise.all([
    prisma.processedWebhook.groupBy({ by: ["topic"], where: { processedAt: { gte: since } }, _count: true }),
    prisma.webhookDelivery.groupBy({ by: ["source"], where: { createdAt: { gte: since } }, _count: true }),
  ]);
  return {
    text: [
      `Webhooks за ${hours} ч:`,
      ...(processed.length ? processed.map((row) => `${row.topic}: ${row._count}`) : ["B2B processed: 0"]),
      ...(deliveries.length ? deliveries.map((row) => `${row.source}: ${row._count}`) : ["Checkout deliveries: 0"]),
    ].join("\n"),
  };
}

export function formatDiloshopActionResult(action: string, result: Record<string, unknown> | null) {
  const label = action === "retry-dilovod" ? "Dilovod" : action === "retry-np" ? "Нова Пошта" : "Статус НП";
  return `${label}: ${scalar(result?.status) || "выполнено"}${scalar(result?.ttn) ? ` · ТТН ${scalar(result?.ttn)}` : ""}`;
}
