import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logCheckoutAbEvent } from "@/lib/checkout-ab/events";

const bodySchema = z.object({
  experimentId: z.string(),
  visitorId: z.string(),
  variant: z.string(),
  eventName: z.string(),
  cartToken: z.string().optional(),
  checkoutSessionId: z.string().optional(),
  shopifyOrderId: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  revenue: z.number().optional(),
  currency: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());
    await logCheckoutAbEvent(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid event" },
      { status: 400 }
    );
  }
}
