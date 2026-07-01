import { NextRequest, NextResponse } from "next/server";
import { searchBranches } from "@/lib/shipping/nova-poshta";

export async function GET(request: NextRequest) {
  const cityRef = request.nextUrl.searchParams.get("cityRef");
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  if (!cityRef) {
    return NextResponse.json({ error: "cityRef required" }, { status: 400 });
  }
  const branches = await searchBranches({ cityRef, query });
  return NextResponse.json(branches);
}
