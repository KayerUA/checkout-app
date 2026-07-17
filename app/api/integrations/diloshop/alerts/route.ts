import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { notifyExternalOpsAlert } from "@/lib/telegram/ops-alerts";

export const runtime = "nodejs";

const payloadSchema = z.object({
  source: z.string().min(1).max(40),
  event_type: z.string().min(1).max(80),
  severity: z.string().max(20).optional(),
  shopify_order_id: z.string().max(40).nullable().optional(),
  message: z.string().min(1).max(1500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function authorized(request: NextRequest, expected: string) {
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const env = getEnv();
  const secret = env.DILOSHOP_BOT_API_KEY || env.DILOSHOP_API_KEY;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const result = await notifyExternalOpsAlert({
    source: parsed.data.source,
    eventType: parsed.data.event_type,
    severity: parsed.data.severity,
    shopifyOrderId: parsed.data.shopify_order_id,
    message: parsed.data.message,
    metadata: parsed.data.metadata,
  });
  return NextResponse.json({ ok: true, ...result });
}
