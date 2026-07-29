import crypto from "node:crypto";
import type { AccountingDispatch, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { writeAutomationLog } from "@/lib/b2b/log";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";
import {
  LEGAL_ENTITY_TRANSPORT_ATTRIBUTE,
  legalEntitySnapshotSchema,
  legalEntityTransport,
  legacyAttributesFromSnapshot,
} from "@/lib/legal-entities/model";

const DISPATCH_LEASE_MS = 5 * 60 * 1000;
const MAX_DISPATCH_BATCH = 50;

type DiloshopDispatchPayload = {
  order: ShopifyOrderPayload;
  shopDomain?: string | null;
  transactionId: string;
};

function getWebhookUrl() {
  const env = getEnv();
  if (env.DILOSHOP_WEBHOOK_URL) return env.DILOSHOP_WEBHOOK_URL;
  if (env.DILOSHOP_API_URL) {
    return `${env.DILOSHOP_API_URL.replace(/\/$/, "")}/webhooks/shopify/orders-dilovod`;
  }
  return null;
}

function hmacBase64(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function appendTags(existing: string | undefined, tags: string[]) {
  const set = new Set(
    (existing ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  );
  tags.forEach((tag) => set.add(tag));
  return Array.from(set).join(", ");
}

export async function notifyDiloshopOrderReady(input: DiloshopDispatchPayload) {
  const env = getEnv();
  if (env.ACCOUNTING_PROVIDER !== "diloshop") {
    return { skipped: true, reason: "provider_disabled" };
  }

  const durableInput = await withImmutableLegalSnapshot(input);
  const dispatchKey = `${input.order.id}:${input.transactionId}`;
  const record = await prisma.accountingDispatch.upsert({
    where: { dispatchKey },
    create: {
      shopifyOrderId: String(input.order.id),
      transactionId: input.transactionId,
      dispatchKey,
      eventType: "orders/paid",
      state: "PENDING",
      payload: durableInput as Prisma.InputJsonValue,
    },
    update: {},
  });
  if (record.state === "DELIVERED") {
    return { skipped: true, reason: "already_dispatched", dispatchKey };
  }
  return dispatchAccountingNotification(record.id);
}

async function withImmutableLegalSnapshot(
  input: DiloshopDispatchPayload
): Promise<DiloshopDispatchPayload> {
  const local = await prisma.b2BOrder.findUnique({
    where: { shopifyOrderId: String(input.order.id) },
    select: { legalEntityId: true, legalEntitySnapshot: true },
  });
  const parsed = legalEntitySnapshotSchema.safeParse(local?.legalEntitySnapshot);
  if (!parsed.success) return input;
  const projected = legacyAttributesFromSnapshot(parsed.data);
  const replacements = new Map<string, string>(
    Object.entries(projected).map(([name, value]) => [name, String(value)])
  );
  replacements.set(
    LEGAL_ENTITY_TRANSPORT_ATTRIBUTE,
    legalEntityTransport(parsed.data)
  );
  if (local?.legalEntityId) replacements.set("legal_entity_id", local.legalEntityId);
  const existing = input.order.note_attributes ?? [];
  const names = new Set(replacements.keys());
  return {
    ...input,
    order: {
      ...input.order,
      note_attributes: [
        ...existing.filter((attribute) => {
          const name = attribute.name ?? attribute.key;
          return !name || !names.has(name);
        }),
        ...Array.from(replacements, ([name, value]) => ({ name, value })),
      ],
    },
  };
}

export async function dispatchPendingAccountingNotifications(limit = MAX_DISPATCH_BATCH) {
  const env = getEnv();
  if (env.ACCOUNTING_PROVIDER !== "diloshop") {
    return { attempted: 0, delivered: 0, failed: 0 };
  }
  const now = new Date();
  const rows = await prisma.accountingDispatch.findMany({
    where: {
      state: { in: ["PENDING", "FAILED_RETRYABLE", "DISPATCHING"] },
      nextAttemptAt: { lte: now },
      OR: [
        { state: { in: ["PENDING", "FAILED_RETRYABLE"] } },
        { state: "DISPATCHING", leaseExpiresAt: { lte: now } },
        { state: "DISPATCHING", leaseExpiresAt: null },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(100, limit)),
    select: { id: true },
  });

  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await dispatchAccountingNotification(row.id);
      if ("ok" in result && result.ok) delivered += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: rows.length, delivered, failed };
}

async function dispatchAccountingNotification(id: string) {
  const claimed = await claimDispatch(id);
  if (!claimed) return { skipped: true, reason: "not_claimed" };

  const payload = claimed.payload as unknown as DiloshopDispatchPayload;
  const orderId = String(payload.order?.id ?? claimed.shopifyOrderId);
  const webhookId = `kayer-b2b-bank-paid-${claimed.dispatchKey}`;
  try {
    const env = getEnv();
    const webhookUrl = getWebhookUrl();
    const secret = env.DILOSHOP_WEBHOOK_SECRET;
    if (!webhookUrl || !secret) {
      throw new Error("Diloshop webhook configuration is incomplete");
    }

    const outgoing: ShopifyOrderPayload & Record<string, unknown> = {
      ...payload.order,
      financial_status: "paid",
      tags: appendTags(payload.order.tags, [
        "B2B_FOP",
        "BANK_TRANSFER_PAID",
        "PAYMENT_CONFIRMED",
        "diloshop_ready",
      ]),
      note_attributes: [
        ...(payload.order.note_attributes ?? []),
        { name: "kayer_b2b_bank_transaction_id", value: payload.transactionId },
        { name: "kayer_b2b_payment_status", value: "BANK_TRANSFER_PAID" },
      ],
    };
    const rawBody = JSON.stringify(outgoing);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": hmacBase64(secret, rawBody),
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Shop-Domain": payload.shopDomain ?? env.SHOPIFY_SHOP_DOMAIN ?? "",
        "X-Shopify-Webhook-Id": webhookId,
      },
      body: rawBody,
    });
    if (!response.ok) {
      throw new Error(`Diloshop webhook HTTP ${response.status}`);
    }

    await prisma.accountingDispatch.update({
      where: { id: claimed.id },
      data: {
        state: "DELIVERED",
        deliveredAt: new Date(),
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    await writeAutomationLog({
      shopifyOrderId: orderId,
      eventType: "diloshop/notify",
      step: "orders_paid_forward",
      status: "OK",
      message: "B2B bank-paid order forwarded to Diloshop",
      metadata: { webhookId },
    });
    return { ok: true, webhookId };
  } catch (error) {
    const attempt = claimed.attempts;
    const retryDelayMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));
    await prisma.accountingDispatch.update({
      where: { id: claimed.id },
      data: {
        state: "FAILED_RETRYABLE",
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + retryDelayMs),
        lastError: safeDispatchError(error),
      },
    });
    throw error;
  }
}

async function claimDispatch(id: string): Promise<AccountingDispatch | null> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + DISPATCH_LEASE_MS);
  const claimed = await prisma.accountingDispatch.updateMany({
    where: {
      id,
      state: { not: "DELIVERED" },
      OR: [
        { state: { in: ["PENDING", "FAILED_RETRYABLE"] }, nextAttemptAt: { lte: now } },
        { state: "DISPATCHING", leaseExpiresAt: { lte: now } },
        { state: "DISPATCHING", leaseExpiresAt: null },
      ],
    },
    data: {
      state: "DISPATCHING",
      leaseExpiresAt,
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.accountingDispatch.findUnique({ where: { id } });
}

function safeDispatchError(error: unknown) {
  if (!(error instanceof Error)) return "Diloshop dispatch failed";
  if (/configuration/i.test(error.message)) return error.message.slice(0, 500);
  const httpStatus = error.message.match(/HTTP\s+\d{3}/i)?.[0];
  return httpStatus ? `Diloshop webhook ${httpStatus}` : "Diloshop dispatch failed";
}
