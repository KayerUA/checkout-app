import { NextRequest, NextResponse } from "next/server";
import { getCheckoutSessionByToken } from "@/lib/checkout/session-service";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request) ?? new NextResponse(null, { status: 204 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const origin = request.headers.get("origin");
  const { token } = await params;
  const rate = await checkRateLimit(
    request,
    { name: "checkout-status", limit: 60, windowSeconds: 60 },
    token
  );
  if (!rate.allowed) {
    return withCors(
      NextResponse.json(
        { error: "Too many status requests" },
        { status: 429, headers: rateLimitHeaders(rate) }
      ),
      origin
    );
  }
  const session = await getCheckoutSessionByToken(token);
  if (!session) {
    return withCors(NextResponse.json({ error: "Not found" }, { status: 404 }), origin);
  }

  const latestPayment = session.paymentAttempts[0];
  return withCors(
    NextResponse.json({
      status: session.status,
      paymentStatus: latestPayment?.status ?? null,
      orderLink: session.orderLink
        ? {
            shopifyOrderName: session.orderLink.shopifyOrderName,
            shopifyOrderGid: session.orderLink.shopifyOrderGid,
          }
        : null,
      fiscalReceipt: session.orderLink?.fiscalReceipt ?? null,
    }),
    origin
  );
}
