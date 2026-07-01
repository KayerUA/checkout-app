import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import {
  computeConversionMetrics,
  getCheckoutAbMetrics,
} from "@/lib/checkout-ab/metrics";

export async function GET() {
  try {
    await requireMerchantSession();
    const metrics = await getCheckoutAbMetrics();
    const conversion = computeConversionMetrics(metrics.events);

    return NextResponse.json({
      ...metrics,
      conversion,
      primaryMetric: "conversion_to_paid_order = payment_success / checkout_click",
      revenuePerClickNote: "revenue_per_checkout_click = paid_revenue / checkout_clicks",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
