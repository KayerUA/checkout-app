import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { reconcileBankPayments } from "@/lib/reconciliation/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const env = getEnv();
  const expected = env.CRON_SECRET || env.INTERNAL_JOBS_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (expected && provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? 7);
  const to = new Date();
  const from = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const result = await reconcileBankPayments({ from, to });
  return NextResponse.json(result);
}
