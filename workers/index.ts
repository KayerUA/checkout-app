import Redis from "ioredis";
import { createWorker, QUEUE_NAMES, WORKER_HEARTBEAT_KEY } from "@/lib/queue";
import { createShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { fiscalizeOrder } from "@/lib/fiscal/checkbox";
import { markAbandonedSessions } from "@/lib/checkout/session-service";
import { syncNovaPoshtaDictionary } from "@/lib/shipping/nova-poshta";
import { log } from "@/lib/logger";
import { getEnv } from "@/lib/env";

function startWorkerHeartbeat() {
  const redis = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });

  async function beat() {
    await redis.set(
      WORKER_HEARTBEAT_KEY,
      JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }),
      "EX",
      90
    );
  }

  beat().catch((error) => {
    log("error", "Worker heartbeat failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return setInterval(() => {
    beat().catch((error) => {
      log("error", "Worker heartbeat failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30_000);
}

async function main() {
  log("info", "Starting workers");
  startWorkerHeartbeat();

  createWorker(QUEUE_NAMES.ORDERS, async (job) => {
    if (job.name === "create-shopify-order") {
      await createShopifyOrderIdempotent(job.data.checkoutSessionId as string);
    }
  });

  createWorker(QUEUE_NAMES.FISCAL, async (job) => {
    if (job.name === "fiscalize-order") {
      await fiscalizeOrder(job.data.orderLinkId as string);
    }
  });

  createWorker(QUEUE_NAMES.ABANDONED, async () => {
    const count = await markAbandonedSessions();
    log("info", "Marked abandoned sessions", { count });
  });

  createWorker(QUEUE_NAMES.NOVA_POSHTA, async () => {
    const result = await syncNovaPoshtaDictionary();
    log("info", "Nova Poshta sync complete", result as LogContext);
  });

  // Schedule recurring jobs
  const { getQueue } = await import("@/lib/queue");
  await getQueue(QUEUE_NAMES.ABANDONED).add(
    "mark-abandoned",
    {},
    { repeat: { every: 15 * 60 * 1000 } }
  );
  await getQueue(QUEUE_NAMES.NOVA_POSHTA).add(
    "sync-dictionary",
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 } }
  );

  log("info", "Workers ready");
}

type LogContext = Record<string, string | number | boolean | null | undefined>;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
