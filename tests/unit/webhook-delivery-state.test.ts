import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as null | {
    id: string;
    webhookId: string;
    status: string;
    attempts: number;
    leaseExpiresAt: Date | null;
    processedAt?: Date;
    lastError?: string | null;
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    processedWebhook: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.row) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        state.row = {
          id: "delivery-1",
          webhookId: String(data.webhookId),
          status: String(data.status),
          attempts: Number(data.attempts),
          leaseExpiresAt: data.leaseExpiresAt as Date,
        };
        return state.row;
      }),
      findUnique: vi.fn(async () => state.row),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!state.row) return { count: 0 };
        const retryable =
          state.row.status === "FAILED" ||
          (state.row.status === "PROCESSING" &&
            (!state.row.leaseExpiresAt || state.row.leaseExpiresAt <= new Date()));
        if (!retryable && "OR" in where) return { count: 0 };
        state.row = {
          ...state.row,
          ...data,
          attempts:
            typeof data.attempts === "object"
              ? state.row.attempts + 1
              : state.row.attempts,
        };
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!state.row) throw new Error("missing");
        state.row = { ...state.row, ...data };
        return state.row;
      }),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ SHOPIFY_WEBHOOK_SECRET: "secret", SHOPIFY_API_SECRET: "secret" }),
}));

import {
  claimWebhookProcessing,
  completeWebhookProcessing,
  failWebhookProcessing,
} from "@/lib/shopify/webhook-security";

const input = {
  webhookId: "webhook-1",
  topic: "orders/create",
  shopDomain: "shop.myshopify.com",
  rawBody: "{\"id\":1}",
};

describe("Shopify webhook delivery state", () => {
  beforeEach(() => {
    state.row = null;
  });

  it("blocks concurrent processing and treats completed delivery as duplicate", async () => {
    await expect(claimWebhookProcessing(input)).resolves.toBe("ACQUIRED");
    await expect(claimWebhookProcessing(input)).resolves.toBe("BUSY");
    await completeWebhookProcessing(input.webhookId);
    await expect(claimWebhookProcessing(input)).resolves.toBe("COMPLETED");
  });

  it("allows a failed delivery to be retried", async () => {
    await claimWebhookProcessing(input);
    await failWebhookProcessing(input.webhookId);
    expect(state.row?.status).toBe("FAILED");
    await expect(claimWebhookProcessing(input)).resolves.toBe("ACQUIRED");
    expect(state.row?.attempts).toBe(2);
  });

  it("recovers a stale processing lease", async () => {
    await claimWebhookProcessing(input);
    if (state.row) state.row.leaseExpiresAt = new Date(0);
    await expect(claimWebhookProcessing(input)).resolves.toBe("ACQUIRED");
  });
});
