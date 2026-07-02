import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { reconcilePendingPayments } from "@/lib/payments/reconciliation";

export const runtime = "nodejs";

export async function POST() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await reconcilePendingPayments({ merchantId: session.merchantId }));
}
