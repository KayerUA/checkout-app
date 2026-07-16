import type { NextRequest } from "next/server";
import { handleStorefrontPricingToken } from "@/lib/checkout/storefront-pricing-token-handler";

/** Shopify App Proxy entry used only to authenticate the logged-in storefront customer. */
export async function GET(request: NextRequest) {
  return handleStorefrontPricingToken(request);
}
