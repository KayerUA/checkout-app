import { NextResponse } from "next/server";
import Redis from "ioredis";
import { prisma } from "@/lib/db";
import { WORKER_HEARTBEAT_KEY } from "@/lib/queue";

type Check =
  | { status: "ok"; detail?: string }
  | { status: "not_configured"; detail?: string }
  | { status: "disabled"; detail?: string }
  | { status: "optional"; detail?: string }
  | { status: "stale"; detail?: string }
  | { status: "unavailable"; detail?: string };

function isWorkerHeartbeatRequired() {
  return process.env.WORKER_HEARTBEAT_REQUIRED === "true";
}

async function checkRedisAndWorker(): Promise<{ redis: Check; worker: Check }> {
  const redisUrl = process.env.REDIS_URL;
  const workerRequired = isWorkerHeartbeatRequired();
  if (!redisUrl) {
    return {
      redis: { status: "not_configured", detail: "REDIS_URL is not set" },
      worker: workerRequired
        ? { status: "not_configured", detail: "worker heartbeat requires Redis" }
        : { status: "optional", detail: "worker is optional; recovery crons are enabled" },
    };
  }

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    commandTimeout: 1500,
  });

  try {
    await redis.connect();
    await redis.ping();
    const heartbeat = await redis.get(WORKER_HEARTBEAT_KEY);
    if (!heartbeat) {
      return {
        redis: { status: "ok" },
        worker: workerRequired
          ? { status: "stale", detail: "worker heartbeat key is missing" }
          : { status: "optional", detail: "worker heartbeat is absent; recovery crons are enabled" },
      };
    }

    return {
      redis: { status: "ok" },
      worker: { status: "ok", detail: heartbeat },
    };
  } catch {
    return {
      redis: {
        status: "unavailable",
        detail: "Redis check failed",
      },
      worker: { status: "unavailable", detail: "worker heartbeat check skipped" },
    };
  } finally {
    redis.disconnect();
  }
}

export async function GET() {
  try {
    // One-release bootstrap for the cumulative bank-payment schema. Removed after production applies it.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "b2b_orders" ADD COLUMN IF NOT EXISTS "expected_amount_uah" DECIMAL(12,2)'
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "b2b_orders" ADD COLUMN IF NOT EXISTS "paid_amount_uah" DECIMAL(12,2) NOT NULL DEFAULT 0'
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "b2b_orders" ADD COLUMN IF NOT EXISTS "remaining_amount_uah" DECIMAL(12,2)'
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "b2b_orders" ADD COLUMN IF NOT EXISTS "payment_status" TEXT NOT NULL DEFAULT 'UNPAID'`
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "bank_payments" ADD COLUMN IF NOT EXISTS "matching_method" TEXT'
    );
    await prisma.$queryRaw`SELECT 1`;
    const queueChecks = await checkRedisAndWorker();
    const degraded =
      queueChecks.redis.status !== "ok" ||
      (isWorkerHeartbeatRequired() && queueChecks.worker.status !== "ok");

    return NextResponse.json({
      status: degraded ? "degraded" : "ok",
      service: "kayer-checkout",
      checks: {
        database: { status: "ok" },
        ...queueChecks,
      },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        service: "kayer-checkout",
        checks: {
          database: {
            status: "unavailable",
            detail: "Database check failed",
          },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
