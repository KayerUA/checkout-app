import { NextRequest, NextResponse } from "next/server";
import {
  getCheckoutSessionByToken,
  serializePublicSession,
  updateCheckoutSession,
} from "@/lib/checkout/session-service";
import { checkoutSessionPatchSchema } from "@/lib/checkout/public-input";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const session = await getCheckoutSessionByToken(token);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(serializePublicSession(session));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const rate = await checkRateLimit(
      request,
      { name: "checkout-update", limit: 120, windowSeconds: 60 },
      token
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many checkout updates" },
        { status: 429, headers: rateLimitHeaders(rate) }
      );
    }
    const body = checkoutSessionPatchSchema.parse(await request.json());
    const session = await updateCheckoutSession(token, body);
    return NextResponse.json(serializePublicSession(
      await getCheckoutSessionByToken(session.publicToken)
    ));
  } catch (error) {
    return apiErrorResponse(error, "Checkout update failed");
  }
}
