import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { saveShopifySession } from "@/lib/shopify/session-store";
import { getMerchantSession } from "@/lib/session";
import { createAuditLog } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { logWithCorrelation } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const shop = request.cookies.get("shopify_oauth_shop")?.value;
  const state = request.cookies.get("shopify_oauth_state")?.value;
  const queryState = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  if (!shop || !state || state !== queryState || !code) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  try {
    const env = getEnv();
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      scope: string;
    };

    const merchant = await prisma.merchant.upsert({
      where: { shopDomain: shop },
      create: {
        shopDomain: shop,
        name: shop.replace(".myshopify.com", ""),
        checkoutBaseUrl: env.APP_URL,
      },
      update: {
        status: "ACTIVE",
      },
    });

    await saveShopifySession(
      merchant.id,
      tokenData.access_token,
      tokenData.scope ?? env.SHOPIFY_SCOPES
    );

    await prisma.fiscalConfig.upsert({
      where: { merchantId: merchant.id },
      create: { merchantId: merchant.id },
      update: {},
    });

    await prisma.analyticsConfig.upsert({
      where: { merchantId: merchant.id },
      create: { merchantId: merchant.id },
      update: {},
    });

    const ironSession = await getMerchantSession();
    ironSession.merchantId = merchant.id;
    ironSession.shopDomain = merchant.shopDomain;
    await ironSession.save();

    await createAuditLog({
      merchantId: merchant.id,
      action: "shopify.installed",
      entityType: "merchant",
      entityId: merchant.id,
    });

    logWithCorrelation("info", "Shopify app installed", {
      merchantId: merchant.id,
    });

    const response = NextResponse.redirect(new URL("/admin", env.APP_URL));
    response.cookies.delete("shopify_oauth_state");
    response.cookies.delete("shopify_oauth_shop");
    return response;
  } catch (error) {
    logWithCorrelation("error", "Shopify OAuth callback failed", {}, {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "OAuth failed" }, { status: 500 });
  }
}
