import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/checkout/session-service";
import { prisma } from "@/lib/db";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { getEnv } from "@/lib/env";
import { publicCheckoutSessionCreateSchema } from "@/lib/checkout/public-input";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiErrorResponse } from "@/lib/api/errors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request) ?? new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const rate = await checkRateLimit(request, {
      name: "checkout-create",
      limit: 20,
      windowSeconds: 60,
    });
    if (!rate.allowed) {
      return withCors(
        NextResponse.json(
          { error: "Too many checkout attempts" },
          { status: 429, headers: rateLimitHeaders(rate) }
        ),
        origin
      );
    }

    const body = publicCheckoutSessionCreateSchema.parse(await request.json());

    let merchantId = body.merchantId;
    if (!merchantId && body.shopDomain) {
      const env = getEnv();
      const configuredShopDomain = env.SHOPIFY_SHOP_DOMAIN;
      const merchant = await prisma.merchant.findUnique({
        where: { shopDomain: body.shopDomain },
      });
      if (merchant) {
        merchantId = merchant.id;
      } else if (configuredShopDomain && body.shopDomain === configuredShopDomain) {
        const createdMerchant = await prisma.merchant.create({
          data: {
            shopDomain: body.shopDomain,
            name: body.shopDomain.replace(".myshopify.com", ""),
            checkoutBaseUrl: env.APP_URL,
          },
        });
        merchantId = createdMerchant.id;
      } else {
        return withCors(
          NextResponse.json({ error: "Merchant not found" }, { status: 404 }),
          origin
        );
      }
    }
    if (!merchantId) {
      return withCors(
        NextResponse.json({ error: "merchantId or shopDomain required" }, { status: 400 }),
        origin
      );
    }

    const session = await createCheckoutSession({
      merchantId,
      cartLines: body.cartLines,
      storefrontCustomerEmail: body.storefrontCustomerEmail,
      storefrontCustomerId: body.storefrontCustomerId,
      storefrontCustomerFirstName: body.storefrontCustomerFirstName,
      storefrontCustomerLastName: body.storefrontCustomerLastName,
      storefrontCustomerPhone: body.storefrontCustomerPhone,
      storefrontPricingToken: body.storefrontPricingToken,
      cartToken: body.cartToken,
      cartItemsSubtotalCents: body.cartItemsSubtotalCents,
      cartTotalCents: body.cartTotalCents,
      buyerIp: request.headers.get("x-forwarded-for") ?? undefined,
      utm: body.utm,
      sourceUrl: body.sourceUrl,
      customAttributes: body.customAttributes,
      ab: body.ab,
    });

    const { emitServerCheckoutEvent } = await import("@/lib/analytics/server");
    await emitServerCheckoutEvent(
      merchantId,
      "begin_checkout",
      session.id,
      session.totalAmount / 100
    );

    return withCors(
      NextResponse.json({
        sessionId: session.id,
        publicToken: session.publicToken,
        checkoutUrl: `/checkout/${session.publicToken}`,
        sourceIdentifier: session.sourceIdentifier,
        totals: {
          subtotal: session.subtotal,
          totalAmount: session.totalAmount,
          currency: session.currency,
        },
      }),
      origin
    );
  } catch (error) {
    return withCors(apiErrorResponse(error, "Failed to create checkout session"), origin);
  }
}
