import { NextRequest, NextResponse } from "next/server";
import {
  addCheckoutSessionLine,
  getCheckoutSessionByToken,
  serializePublicSession,
} from "@/lib/checkout/session-service";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiErrorResponse } from "@/lib/api/errors";

const bodySchema = z.object({
  variantGid: z.string().trim().min(1).max(255),
  quantity: z.number().int().positive().max(20).default(1),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const rate = await checkRateLimit(
      request,
      { name: "checkout-lines", limit: 30, windowSeconds: 60 },
      token
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many cart updates" },
        { status: 429, headers: rateLimitHeaders(rate) }
      );
    }
    const body = bodySchema.parse(await request.json());

    await addCheckoutSessionLine(token, {
      variantGid: body.variantGid,
      quantity: body.quantity,
    });

    const session = await getCheckoutSessionByToken(token);
    return NextResponse.json(serializePublicSession(session));
  } catch (error) {
    return apiErrorResponse(error, "Failed to add product");
  }
}
