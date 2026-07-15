import { NextRequest, NextResponse } from "next/server";
import { handlePaymentCallback } from "@/lib/payments/service";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const result = await handlePaymentCallback("LIQPAY", rawBody, {});
    return NextResponse.json(result);
  } catch (error) {
    console.error("LiqPay callback rejected", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Invalid callback" },
      { status: 400 }
    );
  }
}
