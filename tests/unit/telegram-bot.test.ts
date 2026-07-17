import { describe, expect, it } from "vitest";
import {
  parseTelegramCommand,
  paymentWithoutOrderAlertMessage,
  summarizeBankReconciliation,
  summarizePaymentReconciliation,
  telegramChatIsAllowed,
  telegramGroupChatIds,
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
          status: "PARTIALLY_PAID",
          shopifyOrderName: "#UA1201",
          transactionId: "bank-transaction-12345678",
        },
        {
          status: "PAID_WITH_OVERPAYMENT",
          shopifyOrderName: "#UA1202",
          transactionId: "bank-transaction-87654321",
        },
        { status: "NEEDS_REVIEW" },
      ],
    });
    expect(matched).toContain("#UA1201");
    expect(matched).toContain("…12345678");
    expect(matched).toContain("частичная оплата, ждём доплату");
    expect(matched).toContain("#UA1202");
    expect(matched).toContain("оплата с переплатой");
    expect(matched).toContain("Требуют ручной проверки: 1");
  });

  it("uses an explicit chat allowlist", () => {
    expect(telegramChatIsAllowed(123, undefined)).toBe(false);
    expect(telegramChatIsAllowed(123, "456, 123 -1001")).toBe(true);
    expect(telegramChatIsAllowed(999, "456, 123 -1001")).toBe(false);
    expect(telegramGroupChatIds("5228806558, -4121486955; -4121486955")).toEqual([
      "-4121486955",
    ]);
  });

  it("formats a payment-without-order alert without customer secrets", () => {
    const message = paymentWithoutOrderAlertMessage({
      provider: "LIQPAY",
      amount: 143_450,
      currency: "UAH",
      checkoutSessionId: "session-1",
      sourceIdentifier: "chk_cart_123",
      providerReference: "chk_cart_123_456",
      retryQueued: true,
    });
    expect(message).toContain("Оплата підтверджена");
    expect(message).toContain("1 434,50 UAH");
    expect(message).toContain("chk_cart_123");
    expect(message).toContain("поставлено в чергу");
  });

  it("summarizes reconciliation with actionable error details", () => {
    const message = summarizePaymentReconciliation({
      checked: 4,
      results: [
        { status: "PAID", shopifyOrderName: "#UA1200" },
        { status: "PENDING" },
        {
          status: "error",
          error: "Payment amount mismatch",
          providerReference: "checkout-reference-123456",
        },
        { status: "skipped" },
      ],
    });
    expect(message).toContain("Проверено: 4");
    expect(message).toContain("Оплачено: 1");
    expect(message).toContain("Ошибки: 1");
    expect(message).toContain("Ошибка 1: Payment amount mismatch");
    expect(message).toContain("ref …rence-123456");
    expect(message).toContain("Shopify: #UA1200");
  });
});
