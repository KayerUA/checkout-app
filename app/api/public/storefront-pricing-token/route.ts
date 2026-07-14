import { NextResponse } from "next/server";

/**
 * Partner pricing tokens must originate from the signed Shopify App Proxy route.
 * This route is deliberately retained as a clear failure for old storefront code.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Storefront pricing tokens require Shopify App Proxy authentication" },
    { status: 410 }
  );
}
