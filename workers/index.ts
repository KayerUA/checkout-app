import { createWorker, QUEUE_NAMES } from "@/lib/queue";
import { createShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { fiscalizeOrder } from "@/lib/fiscal/checkbox";
import { markAbandonedSessions } from "@/lib/checkout/session-service";
import { syncNovaPoshtaDictionary } from "@/lib/shipping/nova-poshta";
import { log } from "@/lib/logger";

async function main() {
  log("info", "Starting workers");

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
