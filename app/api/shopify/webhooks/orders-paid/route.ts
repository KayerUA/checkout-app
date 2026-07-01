import { NextRequest } from "next/server";
import { handleB2BShopifyWebhook } from "@/lib/shopify/b2b-webhook-router";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleB2BShopifyWebhook(request, "orders/paid");
}
