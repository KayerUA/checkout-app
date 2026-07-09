import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCheckoutSession } from "@/lib/checkout/session-service";
import { prisma } from "@/lib/db";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { getEnv } from "@/lib/env";

const bodySchema = z.object({
  merchantId: z.string().optional(),
  shopDomain: z.string().optional(),
  cartLines: z.array(
    z.object({
      variantGid: z.string(),
      quantity: z.number().int().positive(),
      unitPriceCents: z.number().int().nonnegative().optional(),
      originalUnitPriceCents: z.number().int().nonnegative().optional(),
    })
  ).min(1),
  utm: z.record(z.string(), z.string()).optional(),
  sourceUrl: z.string().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
  ab: z
    .object({
      experimentId: z.string(),
      visitorId: z.string(),
      variant: z.string(),
      cartToken: z.string().optional(),
    })
    .optional(),
});

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request) ?? new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const body = bodySchema.parse(await request.json());

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
    return withCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to create session" },
        { status: 500 }
      ),
      origin
    );
  }
}
