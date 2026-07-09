import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchPartnerPricingContextByGid } from "@/lib/checkout/partner-pricing";
import { signStorefrontPricingToken } from "@/lib/checkout/storefront-pricing-token";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";
import { getShopFromProxyParams, verifyShopifyAppProxy } from "@/lib/shopify/app-proxy";

const CUSTOMER_EMAIL_QUERY = `
  query StorefrontPricingCustomer($id: ID!) {
    customer(id: $id) {
      id
      email
    }
  }
`;

export async function handleStorefrontPricingToken(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  if (!verifyShopifyAppProxy(searchParams)) {
    return NextResponse.json({ error: "Invalid app proxy signature" }, { status: 401 });
  }

  const shop = getShopFromProxyParams(searchParams);
  const customerId = searchParams.get("logged_in_customer_id");
  if (!shop || !customerId || customerId === "0") {
    return NextResponse.json({ loggedIn: false });
  }

  const merchant = await prisma.merchant.findUnique({ where: { shopDomain: shop } });
  if (!merchant) {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  const shopifySession = await getMerchantShopifySession(merchant.id);
  if (!shopifySession) {
    return NextResponse.json({ error: "Shopify session not found" }, { status: 503 });
  }

  const customerGid = `gid://shopify/Customer/${customerId}`;
  const result = await shopifyAdminGraphQL<{
    data?: { customer?: { id: string; email: string } | null };
  }>(shopifySession, CUSTOMER_EMAIL_QUERY, { id: customerGid });

  const customer = result.data?.customer;
  if (!customer?.email) {
    return NextResponse.json({ loggedIn: false });
  }

  const partnerContext = await fetchPartnerPricingContextByGid(shopifySession, customerGid);
  const pricingToken = signStorefrontPricingToken({
    shop,
    customerGid: customer.id,
    email: customer.email,
  });

  return NextResponse.json({
    loggedIn: true,
    pricingToken,
    email: customer.email,
    customerGid: customer.id,
    isPartner: Boolean(partnerContext),
  });
}
