import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { reconcileMissingShopifyOrders } from "@/lib/shopify/order-reconciliation";

export const runtime = "nodejs";

export async function POST() {
  try {
    await requireMerchantSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await reconcileMissingShopifyOrders());
}
