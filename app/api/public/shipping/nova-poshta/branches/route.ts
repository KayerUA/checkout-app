import { NextRequest, NextResponse } from "next/server";
import { searchBranches } from "@/lib/shipping/nova-poshta";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rate = await checkRateLimit(request, {
    name: "nova-poshta-search",
    limit: 60,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many search requests" },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }
  const cityRef = request.nextUrl.searchParams.get("cityRef");
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  if (cityRef && cityRef.length > 160 || query && query.length > 120) {
    return NextResponse.json({ error: "Invalid search request" }, { status: 400 });
  }
  if (!cityRef) {
    return NextResponse.json({ error: "cityRef required" }, { status: 400 });
  }
  const branches = await searchBranches({ cityRef, query, limit: 100 });
  return NextResponse.json(branches);
}
