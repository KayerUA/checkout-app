import { describe, expect, it } from "vitest";
import {
  parseTelegramCommand,
  summarizeBankReconciliation,
  summarizePaymentReconciliation,
  telegramChatIsAllowed,
} from "@/lib/telegram/bot";

describe("Telegram payments bot", () => {
  it("parses commands and caps reconciliation size", () => {
    expect(parseTelegramCommand("/payments 200")).toEqual({ name: "payments", days: 31 });
    expect(parseTelegramCommand("/check_payments@kayer_bot 3")).toEqual({
      name: "payments",
      days: 3,
    });
    expect(parseTelegramCommand("/online_payments 200")).toEqual({
      name: "online_payments",
      take: 50,
    });
    expect(parseTelegramCommand("/status")).toEqual({ name: "status" });
  });

  it("reports new bank matches or an explicit empty result", () => {
    expect(summarizeBankReconciliation({ checked: 0, results: [] })).toContain(
      "Новых оплат не обнаружено"
    );
    const matched = summarizeBankReconciliation({
      checked: 3,
      results: [
        {
          status: "MATCHED",
          shopifyOrderName: "#UA1201",
          transactionId: "bank-transaction-12345678",
        },
        { status: "NEEDS_REVIEW" },
      ],
    });
    expect(matched).toContain("#UA1201");
    expect(matched).toContain("…12345678");
    expect(matched).toContain("Требуют ручной проверки: 1");
  });

  it("uses an explicit chat allowlist", () => {
    expect(telegramChatIsAllowed(123, undefined)).toBe(false);
    expect(telegramChatIsAllowed(123, "456, 123 -1001")).toBe(true);
    expect(telegramChatIsAllowed(999, "456, 123 -1001")).toBe(false);
  });

  it("summarizes reconciliation without exposing internal errors", () => {
    const message = summarizePaymentReconciliation({
      checked: 4,
      results: [
        { status: "PAID", shopifyOrderName: "#UA1200" },
        { status: "PENDING" },
        { status: "error" },
        { status: "skipped" },
      ],
    });
    expect(message).toContain("Проверено: 4");
    expect(message).toContain("Оплачено: 1");
    expect(message).toContain("Ошибки: 1");
    expect(message).toContain("Shopify: #UA1200");
  });
});
