import { NextRequest, NextResponse } from "next/server";
import { getCheckoutSessionByToken, repriceCheckoutSession } from "@/lib/checkout/session-service";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiErrorResponse } from "@/lib/api/errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const rate = await checkRateLimit(
      request,
      { name: "checkout-reprice", limit: 30, windowSeconds: 60 },
      token
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many pricing requests" },
        { status: 429, headers: rateLimitHeaders(rate) }
      );
    }
    const session = await getCheckoutSessionByToken(token);
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!(["DRAFT", "READY"] as string[]).includes(session.status)) {
      return NextResponse.json({ error: "Checkout pricing is locked" }, { status: 409 });
    }
    const updatedSession = await repriceCheckoutSession(token, 0);
    return NextResponse.json({
      subtotal: updatedSession.subtotal,
      shippingAmount: updatedSession.shippingAmount,
      totalAmount: updatedSession.totalAmount,
      status: updatedSession.status,
    });
  } catch (error) {
    return apiErrorResponse(error, "Checkout pricing failed");
  }
}
