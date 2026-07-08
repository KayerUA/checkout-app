import { NextRequest, NextResponse } from "next/server";
import { repriceCheckoutSession } from "@/lib/checkout/session-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const updatedSession = await repriceCheckoutSession(token, 0);
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
