import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { reconcileBankPayments } from "@/lib/reconciliation/service";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const env = getEnv();
  const expected = env.CRON_SECRET || env.INTERNAL_JOBS_SECRET;
  if (!expected) return true;

  const headerSecret = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");
  return headerSecret === expected || authorization === `Bearer ${expected}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? 7);
  const to = new Date();
  const from = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const result = await reconcileBankPayments({ from, to });
  return NextResponse.json(result);
}
