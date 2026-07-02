import { NextRequest, NextResponse } from "next/server";
import { getCheckoutSessionByToken } from "@/lib/checkout/session-service";
import { reconcilePendingPayments } from "@/lib/payments/reconciliation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const session = await getCheckoutSessionByToken(token);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (session.status === "PAYMENT_PENDING" && session.paymentAttempts[0]?.status === "PENDING") {
    await reconcilePendingPayments({ checkoutSessionId: session.id, take: 1 });
  }

  const refreshed = await getCheckoutSessionByToken(token);
  if (!refreshed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const latestPayment = refreshed.paymentAttempts[0];
  return NextResponse.json({
    status: refreshed.status,
    paymentStatus: latestPayment?.status ?? null,
    orderLink: refreshed.orderLink
      ? {
          shopifyOrderName: refreshed.orderLink.shopifyOrderName,
          shopifyOrderGid: refreshed.orderLink.shopifyOrderGid,
        }
      : null,
    fiscalReceipt: refreshed.orderLink?.fiscalReceipt ?? null,
  });
}
