import { NextRequest, NextResponse } from "next/server";
import { getCheckoutSessionByToken } from "@/lib/checkout/session-service";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const session = await getCheckoutSessionByToken(token);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const latestPayment = session.paymentAttempts[0];
  return NextResponse.json({
    status: session.status,
    paymentStatus: latestPayment?.status ?? null,
    orderLink: session.orderLink
      ? {
          shopifyOrderName: session.orderLink.shopifyOrderName,
          shopifyOrderGid: session.orderLink.shopifyOrderGid,
        }
      : null,
    fiscalReceipt: session.orderLink?.fiscalReceipt ?? null,
  });
}
