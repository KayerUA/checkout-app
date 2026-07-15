import { NextRequest, NextResponse } from "next/server";
import {
  applyCheckoutDiscountCode,
  getCheckoutSessionByToken,
  serializePublicSession,
} from "@/lib/checkout/session-service";
import { CheckoutDiscountError } from "@/lib/checkout/discount-code";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiErrorResponse } from "@/lib/api/errors";

const bodySchema = z
  .object({
    code: z.string().trim().min(1).max(64),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const rate = await checkRateLimit(
      request,
      { name: "checkout-discount", limit: 20, windowSeconds: 60 },
      token
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Забагато спроб застосування промокоду" },
        { status: 429, headers: rateLimitHeaders(rate) }
      );
    }

    const body = bodySchema.parse(await request.json());
    await applyCheckoutDiscountCode(token, body.code);

    const session = await getCheckoutSessionByToken(token);
    return NextResponse.json(serializePublicSession(session));
  } catch (error) {
    if (error instanceof CheckoutDiscountError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Checkout cannot be changed after payment started") {
      return NextResponse.json({ error: "Checkout cannot be changed after payment started" }, { status: 409 });
    }
    return apiErrorResponse(error, "Не вдалося застосувати промокод");
  }
}
