type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramCommand = {
  name: "help" | "myid" | "payments" | "status" | "unknown";
  take?: number;
};

export function parseTelegramCommand(text: string): TelegramCommand {
  const [rawCommand = "", rawTake = ""] = text.trim().split(/\s+/, 2);
  const command = rawCommand.toLowerCase().replace(/@[^\s]+$/, "");
  if (command === "/start" || command === "/help") return { name: "help" };
  if (command === "/myid") return { name: "myid" };
  if (command === "/status") return { name: "status" };
  if (command === "/payments" || command === "/check_payments") {
    const requested = Number.parseInt(rawTake, 10);
    return {
      name: "payments",
      take: Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 20,
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
      "/status — краткий статус оплат",
      "/payments [1-50] — проверить ожидающие оплаты"
    );
  } else {
    lines.push("Платёжные команды закрыты: добавьте chat ID в TG_ALLOWED_CHAT_IDS.");
  }
  return lines.join("\n");
}
