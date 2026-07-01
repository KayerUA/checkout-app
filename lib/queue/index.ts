import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { getEnv } from "@/lib/env";

export const QUEUE_NAMES = {
  PAYMENTS: "reconcile-payments",
  ORDERS: "reconcile-orders",
  FISCAL: "fiscalize-order",
  ABANDONED: "mark-abandoned",
  NOVA_POSHTA: "sync-nova-poshta",
} as const;

const queues = new Map<string, Queue>();

function getConnection(): ConnectionOptions {
  return { url: getEnv().REDIS_URL, maxRetriesPerRequest: null };
}

export function getQueue(name: string) {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: getConnection() }));
  }
  return queues.get(name)!;
}

export async function enqueueJob(
  queueName: string,
  jobName: string,
  data: Record<string, unknown>,
  opts?: { delay?: number; jobId?: string }
) {
  const queue = getQueue(queueName);
  return queue.add(jobName, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
    ...opts,
  });
}

export type JobHandler = (job: Job) => Promise<void>;

export function createWorker(queueName: string, handler: JobHandler) {
  return new Worker(queueName, handler, {
    connection: getConnection(),
  });
}
