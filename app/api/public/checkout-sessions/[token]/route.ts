import { NextRequest, NextResponse } from "next/server";
import {
  getCheckoutSessionByToken,
  serializePublicSession,
  updateCheckoutSession,
} from "@/lib/checkout/session-service";

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const body = await request.json();
    const session = await updateCheckoutSession(token, body);
    return NextResponse.json(serializePublicSession(
      await getCheckoutSessionByToken(session.publicToken)
    ));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 400 }
    );
  }
}
