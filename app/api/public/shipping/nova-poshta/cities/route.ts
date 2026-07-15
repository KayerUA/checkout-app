import { NextRequest, NextResponse } from "next/server";
import { searchCities } from "@/lib/shipping/nova-poshta";
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
  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.length > 120) {
    return NextResponse.json({ error: "Search query is too long" }, { status: 400 });
  }
  if (query.length < 2) {
    return NextResponse.json([]);
  }
  const cities = await searchCities(query);
  return NextResponse.json(cities);
}
