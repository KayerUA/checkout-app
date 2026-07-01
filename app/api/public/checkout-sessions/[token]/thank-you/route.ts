import { NextRequest, NextResponse } from "next/server";
import { getCheckoutSessionByToken, serializePublicSession } from "@/lib/checkout/session-service";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const session = await getCheckoutSessionByToken(token);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(serializePublicSession(session));
}
