import { NextRequest, NextResponse } from "next/server";
import {
  authenticateLegalEntityToken,
  deleteLegalEntity,
  LegalEntityAccessError,
  updateLegalEntity,
} from "@/lib/legal-entities/service";
import { legalEntityV2Enabled } from "@/lib/legal-entities/model";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!legalEntityV2Enabled()) {
    return NextResponse.json({ error: "Legal entity profiles are disabled" }, { status: 404 });
  }
  try {
    const identity = await authenticateLegalEntityToken(request.headers.get("authorization"));
    const { id } = await params;
    const legalEntity = await updateLegalEntity(identity, id, await request.json());
    return NextResponse.json({ legalEntity });
  } catch (error) {
    return legalEntityError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!legalEntityV2Enabled()) {
    return NextResponse.json({ error: "Legal entity profiles are disabled" }, { status: 404 });
  }
  try {
    const identity = await authenticateLegalEntityToken(request.headers.get("authorization"));
    const { id } = await params;
    await deleteLegalEntity(identity, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return legalEntityError(error);
  }
}

function legalEntityError(error: unknown) {
  if (error instanceof LegalEntityAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error
  ) {
    return NextResponse.json({ error: "Invalid legal entity data" }, { status: 400 });
  }
  return NextResponse.json({ error: "Legal entity request failed" }, { status: 500 });
}
