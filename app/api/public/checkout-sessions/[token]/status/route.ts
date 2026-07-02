import { NextRequest, NextResponse } from "next/server";
import { getCheckoutSessionByToken } from "@/lib/checkout/session-service";
import { reconcilePendingPayments } from "@/lib/payments/reconciliation";
import { createShopifyOrderIdempotent } from "@/lib/shopify/order-writer";

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

  let finalSession = refreshed;
  if (refreshed.status === "PAID" && !refreshed.orderLink) {
    await createShopifyOrderIdempotent(refreshed.id);
    const withOrder = await getCheckoutSessionByToken(token);
    if (withOrder) finalSession = withOrder;
  }

  const latestPayment = finalSession.paymentAttempts[0];
  return NextResponse.json({
    status: finalSession.status,
    paymentStatus: latestPayment?.status ?? null,
    orderLink: finalSession.orderLink
      ? {
          shopifyOrderName: finalSession.orderLink.shopifyOrderName,
          shopifyOrderGid: finalSession.orderLink.shopifyOrderGid,
        }
      : null,
    fiscalReceipt: finalSession.orderLink?.fiscalReceipt ?? null,
  });
}
