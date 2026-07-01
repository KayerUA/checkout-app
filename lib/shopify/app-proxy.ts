import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

export function verifyShopifyAppProxy(
  searchParams: URLSearchParams,
  secret = getEnv().SHOPIFY_API_SECRET
): boolean {
  const signature = searchParams.get("signature");
  if (!signature) return false;

  const pairs: string[] = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join("");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function getShopFromProxyParams(searchParams: URLSearchParams): string | null {
  return searchParams.get("shop");
}
