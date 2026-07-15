import crypto from "node:crypto";
import Redis from "ioredis";

type RateLimitPolicy = {
  name: string;
  limit: number;
  windowSeconds: number;
};

type MemoryEntry = { count: number; expiresAt: number };

const memoryStore = new Map<string, MemoryEntry>();
let redis: Redis | null = null;

function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1000,
      enableOfflineQueue: false,
    });
  }
  return redis;
}

function requestIdentity(request: Request, discriminator?: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return crypto
    .createHash("sha256")
    .update(`${ip}:${discriminator ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

function checkMemory(key: string, policy: RateLimitPolicy) {
  const now = Date.now();
  const existing = memoryStore.get(key);
  const entry = !existing || existing.expiresAt <= now
    ? { count: 0, expiresAt: now + policy.windowSeconds * 1000 }
    : existing;
  entry.count += 1;
  memoryStore.set(key, entry);
  return {
    allowed: entry.count <= policy.limit,
    retryAfter: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
  };
}

export async function checkRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  discriminator?: string
) {
  const identity = requestIdentity(request, discriminator);
  const key = `kayer:rate:${policy.name}:${identity}`;
  const client = getRedis();

  if (client) {
    try {
      if (client.status === "wait") await client.connect();
      const result = (await client.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('TTL', KEYS[1]); return {count, ttl}",
        1,
        key,
        String(policy.windowSeconds)
      )) as [number, number];
      return {
        allowed: Number(result[0]) <= policy.limit,
        retryAfter: Math.max(1, Number(result[1]) || policy.windowSeconds),
      };
    } catch {
      // A local fallback still prevents unbounded bursts during a Redis incident.
    }
  }

  return checkMemory(key, policy);
}

export function rateLimitHeaders(result: { retryAfter: number }) {
  return { "Retry-After": String(result.retryAfter) };
}
