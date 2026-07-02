import { NextResponse } from "next/server";
import Redis from "ioredis";
import { prisma } from "@/lib/db";
import { WORKER_HEARTBEAT_KEY } from "@/lib/queue";

type Check =
  | { status: "ok"; detail?: string }
  | { status: "not_configured"; detail?: string }
  | { status: "stale"; detail?: string }
  | { status: "unavailable"; detail?: string };

async function checkRedisAndWorker(): Promise<{ redis: Check; worker: Check }> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      redis: { status: "not_configured", detail: "REDIS_URL is not set" },
      worker: { status: "not_configured", detail: "worker heartbeat requires Redis" },
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
        worker: { status: "stale", detail: "worker heartbeat key is missing" },
      };
    }

    return {
      redis: { status: "ok" },
      worker: { status: "ok", detail: heartbeat },
    };
  } catch (error) {
    return {
      redis: {
        status: "unavailable",
        detail: error instanceof Error ? error.message : "Redis check failed",
      },
      worker: { status: "unavailable", detail: "worker heartbeat check skipped" },
    };
  } finally {
    redis.disconnect();
  }
}

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const queueChecks = await checkRedisAndWorker();
    const degraded =
      queueChecks.redis.status !== "ok" || queueChecks.worker.status !== "ok";

    return NextResponse.json({
      status: degraded ? "degraded" : "ok",
      service: "kayer-checkout",
      checks: {
        database: { status: "ok" },
        ...queueChecks,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        service: "kayer-checkout",
        checks: {
          database: {
            status: "unavailable",
            detail: error instanceof Error ? error.message : "Database check failed",
          },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
