import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { reconcilePendingPayments } from "@/lib/payments/reconciliation";

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

  const take = Number(request.nextUrl.searchParams.get("take") ?? 20);
  const result = await reconcilePendingPayments({ take: Math.min(Math.max(take, 1), 50) });
  return NextResponse.json(result);
}
