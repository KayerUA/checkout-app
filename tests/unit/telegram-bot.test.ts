import { describe, expect, it } from "vitest";
import {
  parseTelegramCommand,
  parseTelegramCallback,
  paymentWithoutOrderAlertMessage,
  summarizeBankReconciliation,
  summarizeAbandonedCheckouts,
  summarizePaymentReconciliation,
  splitTelegramMessage,
  telegramChatIsAllowed,
  telegramGroupChatIds,
  telegramMainMenu,
  telegramUserIsAdmin,
} from "@/lib/telegram/bot";
import { normalizeOrderReference } from "@/lib/telegram/operations";

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
    expect(parseTelegramCommand("/recover_checkout cmrtaic1e000110jlx7qz1g4f")).toEqual({
      name: "recover_checkout",
      arg: "cmrtaic1e000110jlx7qz1g4f",
    });
    expect(parseTelegramCommand("/status")).toEqual({ name: "status" });
    expect(parseTelegramCommand("/start")).toEqual({ name: "menu" });
    expect(parseTelegramCommand("/menu")).toEqual({ name: "menu" });
    expect(parseTelegramCommand("/abandoned@kayer_bot 200")).toEqual({
      name: "abandoned",
      take: 50,
    });
    expect(parseTelegramCommand("/order ua-1183")).toEqual({ name: "order", arg: "ua-1183" });
    expect(parseTelegramCommand("/issues np")).toEqual({ name: "issues", filter: "np", hours: 24 });
    expect(parseTelegramCommand("/unmatched 90")).toEqual({ name: "unmatched", days: 31 });
    expect(parseTelegramCommand("/customer anna@example.com")).toEqual({
      name: "customer",
      arg: "anna@example.com",
    });
  });

  it("formats abandoned checkout contacts and splits long Telegram messages", () => {
    const message = summarizeAbandonedCheckouts([
      {
        sourceIdentifier: "chk_cart_abandoned",
        buyerFirstName: "Анна",
        buyerLastName: "Тест",
        buyerPhone: "+380501112233",
        buyerEmail: "anna@example.com",
        totalAmount: 199_000,
        currency: "UAH",
        abandonedAt: "2026-07-17T08:47:00.000Z",
        updatedAt: "2026-07-17T08:47:00.000Z",
        lines: [{ title: "Luxio Coy", quantity: 3 }],
      },
    ]);
    expect(message).toContain("Анна Тест · 1 990,00 UAH");
    expect(message).toContain("Телефон: +380501112233");
    expect(message).toContain("Email: anna@example.com");
    expect(message).toContain("3× Luxio Coy");
    expect(splitTelegramMessage(`${message}\n\n${message}`, message.length + 1)).toHaveLength(2);
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
    expect(telegramUserIsAdmin(5228806558, "5228806558")).toBe(true);
    expect(telegramUserIsAdmin(1, "5228806558")).toBe(false);
  });

  it("normalizes order references and validates callback payloads", () => {
    expect(normalizeOrderReference("ua-1183")).toEqual({
      input: "ua-1183",
      name: "#UA1183",
      numericId: null,
    });
    expect(normalizeOrderReference("1234567890123").numericId).toBe("1234567890123");
    expect(parseTelegramCallback("confirm|retry-np|123456789")).toEqual({
      name: "confirm",
      action: "retry-np",
      orderId: "123456789",
    });
    expect(parseTelegramCallback("send-invoice|11015715324228")).toEqual({
      name: "send-invoice",
      orderId: "11015715324228",
    });
    expect(parseTelegramCallback("order|oops")).toEqual({ name: "unknown" });
    expect(parseTelegramCallback("unmatched|90")).toEqual({ name: "unmatched", days: 31 });
    expect(parseTelegramCallback("online_payments|200")).toEqual({ name: "online_payments", take: 50 });
    expect(parseTelegramCallback("confirm|recover-shopify-order|cmrtaic1e000110jlx7qz1g4f")).toEqual({
      name: "confirm",
      action: "recover-shopify-order",
      orderId: "cmrtaic1e000110jlx7qz1g4f",
    });
    expect(parseTelegramCallback("confirm|apply-bank-proposal|7c66b6d9-3f5f-4fb8-b012-4d8fd1ef6f6c")).toEqual({
      name: "confirm",
      action: "apply-bank-proposal",
      orderId: "7c66b6d9-3f5f-4fb8-b012-4d8fd1ef6f6c",
    });
    expect(parseTelegramCallback("bank_select|7c66b6d9-3f5f-4fb8-b012-4d8fd1ef6f6c|11022101643588")).toEqual({
      name: "bank_select",
      paymentId: "7c66b6d9-3f5f-4fb8-b012-4d8fd1ef6f6c",
      orderId: "11022101643588",
    });
    const menu = telegramMainMenu(true);
    expect(menu.replyMarkup?.inline_keyboard).toHaveLength(6);
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
        {
          status: "PENDING",
          provider: "LIQPAY",
          shopifyOrderName: "#UA1183",
          amount: 123_450,
          currency: "UAH",
          createdAt: "2026-07-17T10:30:00.000Z",
          providerState: "PENDING",
          sessionStatus: "COMPLETED",
          providerReference: "liqpay-reference-1183",
        },
        {
          status: "error",
          error: "Payment amount mismatch",
          providerReference: "checkout-reference-123456",
        },
        { status: "skipped" },
        {
          status: "removed",
          sessionStatus: "ABANDONED",
          sourceIdentifier: "chk_cart_abandoned",
          buyerFirstName: "Анна",
          buyerLastName: "Тест",
          buyerPhone: "+380501112233",
          buyerEmail: "anna@example.com",
        },
      ],
    });
    expect(message).toContain("Проверено: 4");
    expect(message).toContain("Оплачено: 1");
    expect(message).toContain("Ошибки: 1");
    expect(message).toContain("Ошибка 1: Payment amount mismatch");
    expect(message).toContain("ref …rence-123456");
    expect(message).toContain("Shopify: #UA1200");
    expect(message).toContain("Активно ожидает оплаты: 0");
    expect(message).toContain("Старых/неактивных попыток: 1");
    expect(message).toContain("Старая попытка 1: LIQPAY · Shopify #UA1183");
    expect(message).toContain("1 234,50 UAH");
    expect(message).toContain("заказ уже оплачен, это старая неоплаченная попытка");
    expect(message).toContain("ref …ference-1183");
    expect(message).toContain("Удалено старых попыток: 1");
    expect(message).toContain("Контакт сохранён: Анна Тест · +380501112233 · anna@example.com");
  });
});
