type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramCommand = {
  name: "help" | "myid" | "payments" | "online_payments" | "status" | "unknown";
  take?: number;
  days?: number;
};

export function parseTelegramCommand(text: string): TelegramCommand {
  const [rawCommand = "", rawTake = ""] = text.trim().split(/\s+/, 2);
  const command = rawCommand.toLowerCase().replace(/@[^\s]+$/, "");
  if (command === "/start" || command === "/help") return { name: "help" };
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
  return { name: "unknown" };
}

export function telegramChatIsAllowed(chatId: number | string, configured?: string) {
  if (!configured?.trim()) return false;
  const allowed = new Set(configured.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean));
  return allowed.has(String(chatId));
}

export function summarizePaymentReconciliation(result: {
  checked: number;
  results: Array<{ status?: string; shopifyOrderName?: string | null }>;
}) {
  const counts = new Map<string, number>();
  for (const row of result.results) {
    const status = String(row.status ?? "unknown").toUpperCase();
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const createdOrders = result.results
    .map((row) => row.shopifyOrderName)
    .filter((value): value is string => Boolean(value));
  const rows = [
    "Проверка оплат завершена.",
    `Проверено: ${result.checked}`,
    `Оплачено: ${counts.get("PAID") ?? 0}`,
    `Ожидает: ${counts.get("PENDING") ?? 0}`,
    `Неуспешно: ${counts.get("FAILED") ?? 0}`,
    `Ошибки: ${counts.get("ERROR") ?? 0}`,
    `Пропущено: ${counts.get("SKIPPED") ?? 0}`,
  ];
  if (createdOrders.length) {
    rows.push(`Shopify: ${createdOrders.slice(0, 10).join(", ")}`);
  }
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
  const matched = result.results.filter((row) => row.status === "MATCHED");
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
    lines.push(`✅ ${order}${transaction}`);
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
    "KAYER payments bot",
    "/myid — показать ID этого чата",
  ];
  if (allowed) {
    lines.push(
      "/payments [1-31] — сверить оплаты по банковской выписке",
      "/online_payments [1-50] — проверить LiqPay/Monobank",
      "/status — краткий статус оплат"
    );
  } else {
    lines.push("Платёжные команды закрыты: добавьте chat ID в TG_ALLOWED_CHAT_IDS.");
  }
  return lines.join("\n");
}
