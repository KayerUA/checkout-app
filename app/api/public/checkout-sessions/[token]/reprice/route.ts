import { NextRequest, NextResponse } from "next/server";
import { repriceCheckoutSession } from "@/lib/checkout/session-service";
import { getShippingQuote } from "@/lib/shipping/nova-poshta";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    let shippingAmount = body.shippingAmount as number | undefined;

    if (shippingAmount === undefined) {
      const { prisma } = await import("@/lib/db");
      const session = await prisma.checkoutSession.findUnique({ where: { publicToken: token } });
      if (session) {
        shippingAmount = await getShippingQuote(session.merchantId);
      }
    }

    const session = await repriceCheckoutSession(token, shippingAmount);
    return NextResponse.json({
      subtotal: session.subtotal,
      shippingAmount: session.shippingAmount,
      totalAmount: session.totalAmount,
      status: session.status,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reprice failed" },
      { status: 400 }
    );
  }
}
