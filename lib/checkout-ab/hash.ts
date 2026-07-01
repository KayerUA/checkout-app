import crypto from "node:crypto";

/** Deterministic 0..99 bucket for sticky A/B assignment. */
export function stableHashBucket(input: string): number {
  const digest = crypto.createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0) % 100;
}

export function hashPii(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
