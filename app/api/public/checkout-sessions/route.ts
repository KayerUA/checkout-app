import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCheckoutSession } from "@/lib/checkout/session-service";
import { prisma } from "@/lib/db";
import { handleCorsPreflight, withCors } from "@/lib/cors";

const bodySchema = z.object({
  merchantId: z.string().optional(),
  shopDomain: z.string().optional(),
  cartLines: z.array(
    z.object({
      variantGid: z.string(),
      quantity: z.number().int().positive(),
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
      const merchant = await prisma.merchant.findUnique({
        where: { shopDomain: body.shopDomain },
      });
      if (!merchant) {
        return withCors(
          NextResponse.json({ error: "Merchant not found" }, { status: 404 }),
          origin
        );
      }
      merchantId = merchant.id;
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
