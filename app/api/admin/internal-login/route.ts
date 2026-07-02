import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getMerchantSession } from "@/lib/session";

function safeNextPath(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "/admin";
  return next.startsWith("/admin") ? next : "/admin";
}

export async function POST(request: NextRequest) {
  const env = getEnv();
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const expected = env.ADMIN_PASSWORD || env.INTERNAL_JOBS_SECRET;
  const nextPath = safeNextPath(formData.get("next"));

  if (!expected || password !== expected) {
    const url = new URL("/admin", env.APP_URL);
    url.searchParams.set("error", "invalid_admin_password");
    url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url, { status: 303 });
  }

  if (!env.SHOPIFY_SHOP_DOMAIN) {
    return NextResponse.json({ error: "SHOPIFY_SHOP_DOMAIN is not configured" }, { status: 500 });
  }

  const merchant = await prisma.merchant.upsert({
    where: { shopDomain: env.SHOPIFY_SHOP_DOMAIN },
    create: {
      shopDomain: env.SHOPIFY_SHOP_DOMAIN,
      name: env.SHOPIFY_SHOP_DOMAIN.replace(".myshopify.com", ""),
      checkoutBaseUrl: env.APP_URL,
    },
    update: {
      status: "ACTIVE",
      checkoutBaseUrl: env.APP_URL,
    },
  });

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

  const session = await getMerchantSession();
  session.merchantId = merchant.id;
  session.shopDomain = merchant.shopDomain;
  await session.save();

  return NextResponse.redirect(new URL(nextPath, env.APP_URL), { status: 303 });
}
