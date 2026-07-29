import { beforeEach, describe, expect, it, vi } from "vitest";

const outbox = vi.hoisted(() => ({
  record: null as null | {
    id: string;
    shopifyOrderId: string;
    transactionId: string;
    dispatchKey: string;
    eventType: string;
    state: string;
    payload: unknown;
    attempts: number;
    nextAttemptAt: Date;
    leaseExpiresAt: Date | null;
    deliveredAt: Date | null;
    lastError: string | null;
    createdAt: Date;
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    b2BOrder: {
      findUnique: vi.fn(async () => null),
    },
    accountingDispatch: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        if (!outbox.record) {
          outbox.record = {
            id: "dispatch-1",
            shopifyOrderId: String(create.shopifyOrderId),
            transactionId: String(create.transactionId),
            dispatchKey: String(create.dispatchKey),
            eventType: String(create.eventType),
            state: String(create.state),
            payload: create.payload,
            attempts: 0,
            nextAttemptAt: new Date(0),
            leaseExpiresAt: null,
            deliveredAt: null,
            lastError: null,
            createdAt: new Date(0),
          };
        }
        return { ...outbox.record };
      }),
      updateMany: vi.fn(async () => {
        if (!outbox.record || outbox.record.state === "DELIVERED") return { count: 0 };
        outbox.record.state = "DISPATCHING";
        outbox.record.attempts += 1;
        outbox.record.leaseExpiresAt = new Date(Date.now() + 300_000);
        outbox.record.lastError = null;
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => (outbox.record ? { ...outbox.record } : null)),
      findMany: vi.fn(async () =>
        outbox.record && outbox.record.state !== "DELIVERED"
          ? [{ id: outbox.record.id }]
          : []
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!outbox.record) throw new Error("missing dispatch");
        Object.assign(outbox.record, data);
        return { ...outbox.record };
      }),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    ACCOUNTING_PROVIDER: "diloshop",
    DILOSHOP_WEBHOOK_URL: "https://diloshop.example/webhook",
    DILOSHOP_WEBHOOK_SECRET: "secret",
    SHOPIFY_SHOP_DOMAIN: "shop.myshopify.com",
  }),
}));

vi.mock("@/lib/b2b/log", () => ({
  writeAutomationLog: vi.fn(async () => undefined),
}));

import {
  dispatchPendingAccountingNotifications,
  notifyDiloshopOrderReady,
} from "@/lib/accounting/diloshop";

const payload = {
  order: {
    id: 123,
    name: "#123",
    financial_status: "pending",
    tags: "B2B_FOP",
    note_attributes: [],
  },
  shopDomain: "shop.myshopify.com",
  transactionId: "bank-transaction-1",
};

describe("durable Diloshop accounting outbox", () => {
  beforeEach(() => {
    outbox.record = null;
    vi.restoreAllMocks();
  });

  it("retries a failed delivery and never dispatches a delivered key twice", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    await expect(notifyDiloshopOrderReady(payload)).rejects.toThrow();
    expect(outbox.record?.state).toBe("FAILED_RETRYABLE");
    expect(outbox.record?.lastError).toBe("Diloshop webhook HTTP 503");

    if (outbox.record) outbox.record.nextAttemptAt = new Date(0);
    await expect(dispatchPendingAccountingNotifications()).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      failed: 0,
    });
    expect(outbox.record?.state).toBe("DELIVERED");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(notifyDiloshopOrderReady(payload)).resolves.toMatchObject({
      skipped: true,
      reason: "already_dispatched",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
