import { NextRequest, NextResponse } from "next/server";
import { getShopify } from "@/lib/shopify/client";
import { getEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const env = getEnv();
  const shop = request.nextUrl.searchParams.get("shop") || env.SHOPIFY_SHOP_DOMAIN;
  if (!shop) {
    return NextResponse.json({ error: "Shopify shop is not configured" }, { status: 503 });
  }

  const shopify = getShopify();
  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    return NextResponse.json({ error: "Invalid shop" }, { status: 400 });
  }

  const state = crypto.randomUUID();
  const redirectUri = `${env.APP_URL}/api/auth/shopify/callback`;
  const authUrl = new URL(`https://${sanitizedShop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", env.SHOPIFY_API_KEY);
  authUrl.searchParams.set("scope", env.SHOPIFY_SCOPES);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
  });
  response.cookies.set("shopify_oauth_shop", sanitizedShop, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
  });

  return response;
}
