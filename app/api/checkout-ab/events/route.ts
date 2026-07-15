import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logCheckoutAbEvent } from "@/lib/checkout-ab/events";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

const bodySchema = z.object({
  experimentId: z.string().max(120),
  visitorId: z.string().max(120),
  variant: z.string().max(120),
  eventName: z.enum([
    "checkout_click",
    "checkout_loaded",
    "checkout_error",
    "redirected_to_checkout",
    "shipping_selected",
    "payment_started",
    "payment_success",
    "shopify_order_created",
  ]),
  cartToken: z.string().max(255).optional(),
  checkoutSessionId: z.string().max(255).optional(),
  shopifyOrderId: z.string().max(255).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(32).optional(),
  revenue: z.number().nonnegative().max(100_000_000).optional(),
  currency: z.string().length(3).optional(),
  payload: z.record(z.string().max(64), z.unknown()).optional(),
}).strict().refine(
  (value) => JSON.stringify(value.payload ?? {}).length <= 10_000,
  "Event payload is too large"
);

export async function POST(request: NextRequest) {
  try {
    const rate = await checkRateLimit(request, {
      name: "checkout-ab-events",
      limit: 120,
      windowSeconds: 60,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many events" },
        { status: 429, headers: rateLimitHeaders(rate) }
      );
    }
    const body = bodySchema.parse(await request.json());
    await logCheckoutAbEvent(body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid event" },
      { status: 400 }
    );
  }
}
