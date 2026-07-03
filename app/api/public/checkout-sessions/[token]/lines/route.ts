import { NextRequest, NextResponse } from "next/server";
import {
  addCheckoutSessionLine,
  getCheckoutSessionByToken,
  serializePublicSession,
} from "@/lib/checkout/session-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const body = await request.json();
    if (!body.variantGid || typeof body.variantGid !== "string") {
      return NextResponse.json({ error: "variantGid is required" }, { status: 400 });
    }

    await addCheckoutSessionLine(token, {
      variantGid: body.variantGid,
      quantity: typeof body.quantity === "number" ? body.quantity : 1,
    });

    const session = await getCheckoutSessionByToken(token);
    return NextResponse.json(serializePublicSession(session));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add product" },
      { status: 400 }
    );
  }
}
