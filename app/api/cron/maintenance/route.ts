import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { markAbandonedSessions } from "@/lib/checkout/session-service";
import { syncNovaPoshtaDictionary } from "@/lib/shipping/nova-poshta";

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

  const job = request.nextUrl.searchParams.get("job");
  if (job === "abandoned") {
    return NextResponse.json({ count: await markAbandonedSessions() });
  }
  if (job === "nova-poshta") {
    return NextResponse.json(await syncNovaPoshtaDictionary());
  }
  return NextResponse.json({ error: "Unknown maintenance job" }, { status: 400 });
}
