type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramCommand = {
  name:
    | "help"
    | "menu"
    | "myid"
    | "payments"
    | "online_payments"
    | "recover_checkout"
    | "abandoned"
    | "status"
    | "order"
    | "issues"
    | "today"
    | "health"
    | "queue"
    | "unmatched"
    | "bank_review"
    | "np"
    | "b2b"
    | "cashin"
    | "refund"
    | "sku"
    | "customer"
    | "webhooks"
    | "mapping_gaps"
    | "unknown";
  take?: number;
  days?: number;
  hours?: number;
  arg?: string;
  filter?: string;
};

export function parseTelegramCommand(text: string): TelegramCommand {
  const [rawCommand = "", ...rest] = text.trim().split(/\s+/);
  const rawTake = rest[0] ?? "";
  const arg = rest.join(" ").trim();
  const command = rawCommand.toLowerCase().replace(/@[^\s]+$/, "");
  if (command === "/start" || command === "/menu") return { name: "menu" };
  if (command === "/help") return { name: "help" };
  if (command === "/myid") return { name: "myid" };
  if (command === "/status") return { name: "status" };
  if (command === "/payments" || command === "/check_payments") {
    const requestedDays = Number.parseInt(rawTake, 10);
    return {
      name: "payments",
      days: Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), 31) : 7,
    };
  }
  if (command === "/online_payments") {
    const requestedTake = Number.parseInt(rawTake, 10);
    return {
      name: "online_payments",
      take: Number.isFinite(requestedTake) ? Math.min(Math.max(requestedTake, 1), 50) : 20,
    };
  }
  if (command === "/recover_checkout") return { name: "recover_checkout", arg };
  if (command === "/abandoned") {
    const requestedTake = Number.parseInt(rawTake, 10);
    return {
      name: "abandoned",
      take: Number.isFinite(requestedTake) ? Math.min(Math.max(requestedTake, 1), 50) : 10,
    };
  }
  if (["/order", "/np", "/b2b", "/cashin", "/refund"].includes(command)) {
    return { name: command.slice(1) as "order" | "np" | "b2b" | "cashin" | "refund", arg };
  }
  if (command === "/issues") {
    const filter = rawTake.toLowerCase();
    return {
      name: "issues",
      filter: ["payments", "np", "dilovod", "b2b", "fiscal", "all"].includes(filter)
        ? filter
        : "all",
      hours: 24,
    };
  }
  if (command === "/today") return { name: "today" };
  if (command === "/health") return { name: "health" };
  if (command === "/queue") return { name: "queue" };
  if (command === "/unmatched") {
    const requestedDays = Number.parseInt(rawTake, 10);
    return { name: "unmatched", days: Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), 31) : 7 };
  }
  if (command === "/bank_review") return { name: "bank_review" };
  if (command === "/sku") return { name: "sku", arg };
  if (command === "/customer") return { name: "customer", arg };
  if (command === "/webhooks") {
    const requestedHours = Number.parseInt(rawTake, 10);
    return { name: "webhooks", hours: Number.isFinite(requestedHours) ? Math.min(Math.max(requestedHours, 1), 168) : 24 };
  }
  if (command === "/mapping_gaps") return { name: "mapping_gaps" };
  return { name: "unknown" };
}

export const telegramGroupBotCommands = [
  { command: "menu", description: "Главная панель операций" },
  { command: "order", description: "Карточка заказа во всех системах" },
  { command: "issues", description: "Проблемы Checkout, Dilovod и НП" },
  { command: "today", description: "Сводка за сегодня" },
  { command: "health", description: "Проверить сервисы и workers" },
  { command: "queue", description: "Очереди Checkout и Diloshop" },
  { command: "payments", description: "Сверить оплаты по банковской выписке" },
  { command: "online_payments", description: "Проверить LiqPay/Monobank" },
  { command: "recover_checkout", description: "Повторить Shopify-заказ из checkout" },
  { command: "unmatched", description: "Банковские оплаты без матча" },
  { command: "bank_review", description: "Ручной разбор банковских оплат" },
  { command: "abandoned", description: "Показать незавершённые checkout" },
  { command: "help", description: "Показать команды" },
];

export const telegramPrivateBotCommands = [
  ...telegramGroupBotCommands,
  { command: "np", description: "ТТН и статус Новой Почты" },
  { command: "b2b", description: "B2B оплата и документы" },
  { command: "cashin", description: "Поступление денег в Dilovod" },
  { command: "refund", description: "Возврат Shopify и Dilovod" },
  { command: "sku", description: "Mapping товара Shopify ↔ Dilovod" },
  { command: "customer", description: "Найти клиента по телефону/email" },
  { command: "webhooks", description: "Состояние Shopify webhooks" },
  { command: "mapping_gaps", description: "Разрывы Shopify ↔ Dilovod" },
  { command: "myid", description: "Показать ID чата и пользователя" },
];

export const telegramBotCommands = telegramGroupBotCommands;

export function summarizeAbandonedCheckouts(
  sessions: Array<{
    sourceIdentifier?: string | null;
    buyerFirstName?: string | null;
    buyerLastName?: string | null;
    buyerPhone?: string | null;
    buyerEmail?: string | null;
    totalAmount: number;
    currency: string;
    abandonedAt?: Date | string | null;
    updatedAt: Date | string;
    lines: Array<{ title: string; quantity: number }>;
  }>
) {
  if (!sessions.length) return "Незавершённых checkout с контактами нет.";

  const rows = [`Незавершённые checkout: ${sessions.length}`];
  sessions.forEach((session, index) => {
    const name = [session.buyerFirstName, session.buyerLastName].filter(Boolean).join(" ") || "Без имени";
    const amount = new Intl.NumberFormat("uk-UA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(session.totalAmount / 100);
    const activity = new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Kyiv",
    }).format(new Date(session.abandonedAt ?? session.updatedAt));
    const cart = session.lines
      .map((line) => `${line.quantity}× ${line.title}`)
      .join(", ")
      .slice(0, 240) || "кошик порожній";
    rows.push(
      [
        `${index + 1}. ${name} · ${amount} ${session.currency} · ${activity}`,
        `Телефон: ${session.buyerPhone || "не указан"}`,
        `Email: ${session.buyerEmail || "не указан"}`,
        `Корзина: ${cart}`,
        `Checkout: ${session.sourceIdentifier || "без идентификатора"}`,
      ].join("\n")
    );
  });
  return rows.join("\n\n");
}

export function splitTelegramMessage(text: string, maxLength = 3800) {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const block of text.split("\n\n")) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = block.slice(0, maxLength);
  }
  if (current) chunks.push(current);
  return chunks;
}

export function telegramChatIsAllowed(chatId: number | string, configured?: string) {
  if (!configured?.trim()) return false;
  const allowed = new Set(configured.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean));
  return allowed.has(String(chatId));
}

export function telegramUserIsAdmin(userId: number | string, configured?: string) {
  if (!configured?.trim()) return false;
  const allowed = new Set(configured.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean));
  return allowed.has(String(userId));
}

export type TelegramCallback =
  | { name: "menu" }
  | { name: "today" }
  | { name: "unmatched"; days: number }
  | { name: "bank_review" }
  | { name: "bank_payment"; paymentId: string }
  | { name: "bank_select"; paymentId: string; orderId: string }
  | { name: "abandoned"; take: number }
  | { name: "online_payments"; take: number }
  | { name: "payments"; days: number }
  | { name: "order_help" }
  | { name: "order"; orderId: string }
  | { name: "lookup"; reference: string }
  | { name: "send-invoice"; orderId: string }
  | { name: "issues"; hours: number; filter: string }
  | { name: "health" }
  | { name: "queue" }
  | { name: "confirm"; action: string; orderId: string }
  | { name: "run"; action: string; orderId: string }
  | { name: "cancel" }
  | { name: "unknown" };

const telegramOrderActionNames = new Set([
  "retry-dilovod",
  "retry-np",
  "refresh-np",
  "recover-shopify-order",
  "apply-bank-proposal",
]);

export function parseTelegramCallback(data: string): TelegramCallback {
  const [name, first = "", second = ""] = data.split("|", 3);
  if (name === "menu") return { name: "menu" };
  if (name === "today") return { name: "today" };
  if (name === "order_help") return { name: "order_help" };
  if (name === "unmatched") return { name, days: Math.min(Math.max(Number(first) || 7, 1), 31) };
  if (name === "bank_review") return { name };
  if (name === "bank_payment" && /^[0-9a-f-]{36}$/i.test(first)) return { name, paymentId: first };
  if (name === "bank_select" && /^[0-9a-f-]{36}$/i.test(first) && /^\d+$/.test(second)) return { name, paymentId: first, orderId: second };
  if (name === "abandoned") return { name, take: Math.min(Math.max(Number(first) || 10, 1), 50) };
  if (name === "online_payments") return { name, take: Math.min(Math.max(Number(first) || 20, 1), 50) };
  if (name === "payments") return { name, days: Math.min(Math.max(Number(first) || 7, 1), 31) };
  if (name === "order" && /^\d+$/.test(first)) return { name: "order", orderId: first };
  if (name === "lookup" && first) return { name: "lookup", reference: first };
  if (name === "send-invoice" && /^\d+$/.test(first)) {
    return { name: "send-invoice", orderId: first };
  }
  if (name === "issues") {
    return { name: "issues", hours: Math.min(Math.max(Number(first) || 24, 1), 720), filter: second || "all" };
  }
  if (name === "health") return { name: "health" };
  if (name === "queue") return { name: "queue" };
  const validTarget = first === "recover-shopify-order"
    ? /^c[a-z0-9]{10,}$/i.test(second)
    : first === "apply-bank-proposal"
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(second)
    : /^\d+$/.test(second);
  if ((name === "confirm" || name === "run") && telegramOrderActionNames.has(first) && validTarget) {
    return { name, action: first, orderId: second };
  }
  if (name === "cancel") return { name: "cancel" };
  return { name: "unknown" };
}

export function telegramConfirmationKeyboard(action: string, orderId: string) {
  return {
    inline_keyboard: [[
      { text: "✅ Подтвердить", callback_data: `run|${action}|${orderId}` },
      { text: "Отмена", callback_data: "cancel" },
    ]],
  };
}

export function telegramMainMenu(allowed: boolean) {
  if (!allowed) {
    return {
      text: "KAYER operations bot\n\nДоступ к операциям пока не открыт для этого чата.\n\nОтправьте /myid — он нужен, чтобы добавить чат в доступ.",
    };
  }
  return {
    text: [
      "KAYER · операционная панель",
      "",
      "Выберите проверку ниже или просто отправьте номер заказа: UA1183.",
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "📊 Сегодня", callback_data: "today" },
          { text: "🚨 Проблемы", callback_data: "issues|24|all" },
        ],
        [
          { text: "💳 Банк без матча", callback_data: "unmatched|7" },
          { text: "🔁 Сверить банк", callback_data: "payments|7" },
        ],
        [{ text: "🧾 Ручной разбор платежей", callback_data: "bank_review" }],
        [
          { text: "🌐 Онлайн-оплаты", callback_data: "online_payments|20" },
          { text: "🛒 Брошенные корзины", callback_data: "abandoned|10" },
        ],
        [
          { text: "⚙️ Очереди", callback_data: "queue" },
          { text: "🩺 Здоровье", callback_data: "health" },
        ],
        [{ text: "🔎 Как найти заказ", callback_data: "order_help" }],
      ],
    },
  };
}

export function telegramMenuKeyboard() {
  return [{ text: "⌂ Главное меню", callback_data: "menu" }];
}

export function telegramGroupChatIds(configured?: string) {
  if (!configured?.trim()) return [];
  return Array.from(
    new Set(
      configured
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter((value) => /^-\d+$/.test(value))
    )
  );
}

export function paymentWithoutOrderAlertMessage(input: {
  provider: string;
  amount: number;
  currency: string;
  checkoutSessionId: string;
  sourceIdentifier?: string | null;
  providerReference?: string | null;
  retryQueued?: boolean;
}) {
  const amount = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(input.amount / 100);
  return [
    "🚨 Оплата підтверджена, але Shopify-замовлення відсутнє",
    `Провайдер: ${input.provider}`,
    `Сума: ${amount} ${input.currency}`,
    `Checkout: ${input.checkoutSessionId}`,
    `Джерело: ${input.sourceIdentifier || "—"}`,
    `Reference: ${input.providerReference || "—"}`,
    `Повтор створення: ${input.retryQueued ? "поставлено в чергу" : "не поставлено в чергу"}`,
    "Потрібна ручна перевірка в checkout admin.",
  ].join("\n");
}

export function summarizePaymentReconciliation(result: {
  checked: number;
  results: Array<{
    status?: string;
    shopifyOrderName?: string | null;
    sourceIdentifier?: string | null;
    provider?: string;
    amount?: number;
    currency?: string;
    createdAt?: Date | string;
    providerState?: string;
    sessionStatus?: string;
    buyerEmail?: string | null;
    buyerPhone?: string | null;
    buyerFirstName?: string | null;
    buyerLastName?: string | null;
    providerReference?: string | null;
    error?: string;
    reason?: string;
  }>;
}) {
  const counts = new Map<string, number>();
  for (const row of result.results) {
    const status = String(row.status ?? "unknown").toUpperCase();
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const createdOrders = result.results
    .map((row) => row.shopifyOrderName)
    .filter((value): value is string => Boolean(value));
  const pending = result.results.filter(
    (row) => String(row.status ?? "").toUpperCase() === "PENDING"
  );
  const inactiveSessionStatuses = new Set(["PAID", "COMPLETED", "ABANDONED"]);
  const inactivePending = pending.filter((row) =>
    inactiveSessionStatuses.has(String(row.sessionStatus ?? "").toUpperCase())
  );
  const activePending = pending.length - inactivePending.length;
  const rows = [
    "Проверка оплат завершена.",
    `Проверено: ${result.checked}`,
    `Оплачено: ${counts.get("PAID") ?? 0}`,
    `Активно ожидает оплаты: ${activePending}`,
    `Старых/неактивных попыток: ${inactivePending.length}`,
    `Удалено старых попыток: ${counts.get("REMOVED") ?? 0}`,
    `Неуспешно: ${counts.get("FAILED") ?? 0}`,
    `Ошибки: ${counts.get("ERROR") ?? 0}`,
    `Пропущено: ${counts.get("SKIPPED") ?? 0}`,
  ];
  if (createdOrders.length) {
    rows.push(`Shopify: ${createdOrders.slice(0, 10).join(", ")}`);
  }
  pending.slice(0, 10).forEach((row, index) => {
    const inactive = inactiveSessionStatuses.has(
      String(row.sessionStatus ?? "").toUpperCase()
    );
    const order = row.shopifyOrderName
      ? `Shopify ${row.shopifyOrderName}`
      : `Shopify-заказ не создан · ${row.sourceIdentifier || "checkout без номера"}`;
    const provider = row.provider ? `${row.provider} · ` : "";
    const amount = typeof row.amount === "number"
      ? ` · ${new Intl.NumberFormat("uk-UA", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(row.amount / 100)} ${row.currency || "UAH"}`
      : "";
    const createdAt = row.createdAt
      ? ` · ${new Intl.DateTimeFormat("uk-UA", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Kyiv",
        }).format(new Date(row.createdAt))}`
      : "";
    const providerState = inactive
      ? row.sessionStatus === "ABANDONED"
        ? " · брошенная платёжная ссылка"
        : " · заказ уже оплачен, это старая неоплаченная попытка"
      : row.providerState === "NOT_FOUND"
        ? " · провайдер не нашёл оплаченную операцию"
        : " · провайдер ещё не подтвердил оплату";
    const reference = row.providerReference
      ? ` · ref …${row.providerReference.slice(-12)}`
      : "";
    rows.push(
      `${inactive ? "Старая попытка" : "Ожидает"} ${index + 1}: ${provider}${order}${amount}${createdAt}${providerState}${reference}`
    );
  });
  const removed = result.results.filter(
    (row) => String(row.status ?? "").toUpperCase() === "REMOVED"
  );
  removed.slice(0, 10).forEach((row) => {
    const order = row.shopifyOrderName
      ? `Shopify ${row.shopifyOrderName}`
      : row.sourceIdentifier || "checkout без номера";
    if (row.sessionStatus === "ABANDONED") {
      const name = [row.buyerFirstName, row.buyerLastName].filter(Boolean).join(" ") || "Без имени";
      rows.push(
        `Контакт сохранён: ${name} · ${row.buyerPhone || "телефон не указан"} · ${row.buyerEmail || "email не указан"} · ${order}`
      );
    } else {
      rows.push(`Старая неоплаченная попытка удалена: ${order}`);
    }
  });
  const errors = result.results.filter(
    (row) => String(row.status ?? "").toUpperCase() === "ERROR"
  );
  errors.slice(0, 5).forEach((row, index) => {
    const message = String(row.error || row.reason || "неизвестная ошибка")
      .replace(/\s+/g, " ")
      .slice(0, 180);
    const reference = row.providerReference
      ? ` · ref …${row.providerReference.slice(-12)}`
      : "";
    rows.push(`Ошибка ${index + 1}: ${message}${reference}`);
  });
  return rows.join("\n");
}

export function summarizeBankReconciliation(result: {
  checked: number;
  results: Array<{
    status?: string;
    shopifyOrderId?: string;
    shopifyOrderName?: string | null;
    transactionId?: string;
  }>;
}) {
  const matchedStatuses = new Set([
    "MATCHED",
    "PARTIALLY_PAID",
    "PAID",
    "PAID_WITH_OVERPAYMENT",
  ]);
  const matched = result.results.filter((row) =>
    matchedStatuses.has(String(row.status ?? "").toUpperCase())
  );
  const needsReview = result.results.filter((row) => row.status === "NEEDS_REVIEW").length;
  const errors = result.results.filter((row) => row.status === "ERROR").length;

  const lines = matched.length
    ? ["Новые банковские оплаты:"]
    : ["Новых оплат не обнаружено."];
  for (const row of matched.slice(0, 20)) {
    const order = row.shopifyOrderName || row.shopifyOrderId || "заказ без номера";
    const transaction = row.transactionId
      ? ` · транзакция …${row.transactionId.slice(-8)}`
      : "";
    const status = String(row.status ?? "").toUpperCase();
    const marker = status === "PARTIALLY_PAID" ? "🟡" : "✅";
    const suffix =
      status === "PARTIALLY_PAID"
        ? " · частичная оплата, ждём доплату"
        : status === "PAID_WITH_OVERPAYMENT"
          ? " · оплата с переплатой"
          : "";
    lines.push(`${marker} ${order}${transaction}${suffix}`);
  }
  lines.push(`Проверено операций: ${result.checked}`);
  if (needsReview) lines.push(`Требуют ручной проверки: ${needsReview}`);
  if (errors) lines.push(`Ошибки обработки: ${errors}`);
  return lines.join("\n");
}

export async function telegramApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>
) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API failed with ${response.status}`);
  }
  return data.result as T;
}

export function telegramHelpMessage(allowed: boolean) {
  const lines = [
    "KAYER operations bot",
    "/menu — главная панель с быстрыми кнопками",
    "/myid — показать ID чата и пользователя",
  ];
  if (allowed) {
    lines.push(
      "/order UA1183 — единая карточка заказа",
      "/issues [payments|np|dilovod|b2b] — проблемы",
      "/today — сводка за сегодня",
      "/health — состояние сервисов",
      "/queue — очереди Checkout/Diloshop",
      "/payments [1-31] — сверить оплаты по банковской выписке",
      "/online_payments [1-50] — проверить LiqPay/Monobank",
      "/recover_checkout ID|source — аварийно повторить Shopify-заказ (только admin)",
      "/unmatched [1-31] — банковские оплаты без матча",
      "/abandoned [1-50] — показать незавершённые checkout с контактами",
      "/np, /b2b, /cashin, /refund UA1183 — детали заказа",
      "/sku SKU — mapping товара",
      "/customer телефон|email — найти клиента",
      "/webhooks [1-168] — состояние webhook'ов",
      "/mapping_gaps — покрытие mapping товаров"
    );
  } else {
    lines.push("Платёжные команды закрыты: добавьте chat ID в TG_ALLOWED_CHAT_IDS.");
  }
  return lines.join("\n");
}
