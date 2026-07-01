import { NextRequest, NextResponse } from "next/server";
import { searchCities } from "@/lib/shipping/nova-poshta";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.length < 2) {
    return NextResponse.json([]);
  }
  const cities = await searchCities(query);
  return NextResponse.json(cities);
}
