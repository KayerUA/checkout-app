import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

const TOKEN_TTL_SEC = 15 * 60;

function getPricingTokenSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  return getEnv().SESSION_SECRET;
}

export type StorefrontPricingTokenPayload = {
  v: 1;
  shop: string;
  customerGid: string;
  email: string;
  exp: number;
};

export function signStorefrontPricingToken(input: {
  shop: string;
  customerGid: string;
  email: string;
  ttlSec?: number;
}): string {
  const exp = Math.floor(Date.now() / 1000) + (input.ttlSec ?? TOKEN_TTL_SEC);
  const body: StorefrontPricingTokenPayload = {
    v: 1,
    shop: input.shop,
    customerGid: input.customerGid,
    email: normalizeTokenEmail(input.email),
    exp,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = crypto.createHmac("sha256", getPricingTokenSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyStorefrontPricingToken(
  token: string,
  expectedShop?: string
): StorefrontPricingTokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", getPricingTokenSecret())
    .update(encoded)
    .digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig))) return null;
  } catch {
    return null;
  }

  let payload: StorefrontPricingTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StorefrontPricingTokenPayload;
  } catch {
    return null;
  }

  if (payload.v !== 1) return null;
  if (!payload.shop || !payload.customerGid || !payload.email) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (expectedShop && payload.shop !== expectedShop) return null;

  return payload;
}

function normalizeTokenEmail(email: string): string {
  return email.trim().toLowerCase();
}
