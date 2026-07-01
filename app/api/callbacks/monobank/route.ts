import { NextRequest, NextResponse } from "next/server";
import { handlePaymentCallback } from "@/lib/payments/service";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.arrayBuffer();
    const result = await handlePaymentCallback(
      "MONOBANK",
      Buffer.from(rawBody),
      { "x-sign": request.headers.get("x-sign") ?? undefined }
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Callback failed" },
      { status: 400 }
    );
  }
}
