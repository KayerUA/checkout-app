import { NextRequest, NextResponse } from "next/server";
import { searchBranches } from "@/lib/shipping/nova-poshta";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getCheckoutSessionByToken } from "@/lib/checkout/session-service";
import { canUseNovaPoshtaPostomat } from "@/lib/shipping/nova-poshta-postomat-policy";

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
  const checkoutToken = request.nextUrl.searchParams.get("checkoutToken");
  if (cityRef && cityRef.length > 160 || query && query.length > 120) {
    return NextResponse.json({ error: "Invalid search request" }, { status: 400 });
  }
  if (!cityRef) {
    return NextResponse.json({ error: "cityRef required" }, { status: 400 });
  }
  let includePostomats = true;
  if (checkoutToken) {
    const session = await getCheckoutSessionByToken(checkoutToken);
    if (!session) return NextResponse.json({ error: "Checkout not found" }, { status: 404 });
    includePostomats = canUseNovaPoshtaPostomat({
      totalAmountCents: session.totalAmount,
      shopifyCustomerGid: session.shopifyCustomerGid,
    });
  }
  const branches = await searchBranches({ cityRef, query, limit: 100, includePostomats });
  return NextResponse.json(branches);
}
