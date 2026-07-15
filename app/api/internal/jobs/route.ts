import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

function authorize(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  return secret === getEnv().INTERNAL_JOBS_SECRET;
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await request.json();
  const { markAbandonedSessions } = await import("@/lib/checkout/session-service");
  const { syncNovaPoshtaDictionary } = await import("@/lib/shipping/nova-poshta");

  switch (job) {
    case "mark-abandoned": {
      const count = await markAbandonedSessions();
      return NextResponse.json({ count });
    }
    case "reconcile-orders": {
      const { reconcileMissingShopifyOrders } = await import("@/lib/shopify/order-reconciliation");
      return NextResponse.json(await reconcileMissingShopifyOrders());
    }
    case "reconcile-payments": {
      const { reconcilePendingPayments } = await import("@/lib/payments/reconciliation");
      return NextResponse.json(await reconcilePendingPayments());
    }
    case "reconcile-fiscal": {
      const { reconcileFiscalReceipts } = await import("@/lib/fiscal/reconciliation");
      return NextResponse.json(await reconcileFiscalReceipts());
    }
    case "sync-nova-poshta": {
      const result = await syncNovaPoshtaDictionary();
      return NextResponse.json(result);
    }
    default:
      return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }
}
