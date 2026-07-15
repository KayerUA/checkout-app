import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { reconcileFiscalReceipts } from "@/lib/fiscal/reconciliation";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const expected = getEnv().CRON_SECRET || getEnv().INTERNAL_JOBS_SECRET;
  return request.headers.get("authorization") === `Bearer ${expected}` ||
    request.headers.get("x-cron-secret") === expected;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await reconcileFiscalReceipts());
}
