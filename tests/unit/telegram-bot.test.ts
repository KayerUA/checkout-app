import { describe, expect, it } from "vitest";
import {
  parseTelegramCommand,
  summarizePaymentReconciliation,
  telegramChatIsAllowed,
} from "@/lib/telegram/bot";

describe("Telegram payments bot", () => {
  it("parses commands and caps reconciliation size", () => {
    expect(parseTelegramCommand("/payments 200")).toEqual({ name: "payments", take: 50 });
    expect(parseTelegramCommand("/check_payments@kayer_bot 3")).toEqual({
      name: "payments",
      take: 3,
    });
    expect(parseTelegramCommand("/status")).toEqual({ name: "status" });
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
