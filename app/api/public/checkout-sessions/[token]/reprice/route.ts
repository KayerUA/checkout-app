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
    const { prisma } = await import("@/lib/db");
    const session = await prisma.checkoutSession.findUnique({ where: { publicToken: token } });
    const attrs = (session?.customAttributes ?? {}) as Record<string, unknown>;
    const isBankInvoiceBuyer =
      attrs.buyer_type === "fop_company" && attrs.payment_preference === "bank_invoice";

    if (isBankInvoiceBuyer) {
      shippingAmount = 0;
    } else if (shippingAmount === undefined && session) {
      shippingAmount = await getShippingQuote(session.merchantId);
    }

    const updatedSession = await repriceCheckoutSession(token, shippingAmount);
    return NextResponse.json({
      subtotal: updatedSession.subtotal,
      shippingAmount: updatedSession.shippingAmount,
      totalAmount: updatedSession.totalAmount,
      status: updatedSession.status,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reprice failed" },
      { status: 400 }
    );
  }
}
