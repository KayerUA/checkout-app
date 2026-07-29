import { NextRequest, NextResponse } from "next/server";
import {
  authenticateLegalEntityToken,
  createLegalEntity,
  LegalEntityAccessError,
  listLegalEntities,
} from "@/lib/legal-entities/service";
import { legalEntityV2Enabled } from "@/lib/legal-entities/model";

export async function GET(request: NextRequest) {
  if (!legalEntityV2Enabled()) {
    return NextResponse.json({ error: "Legal entity profiles are disabled" }, { status: 404 });
  }
  try {
    const identity = await authenticateLegalEntityToken(request.headers.get("authorization"));
    return NextResponse.json({ legalEntities: await listLegalEntities(identity) });
  } catch (error) {
    return legalEntityError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!legalEntityV2Enabled()) {
    return NextResponse.json({ error: "Legal entity profiles are disabled" }, { status: 404 });
  }
  try {
    const identity = await authenticateLegalEntityToken(request.headers.get("authorization"));
    const legalEntity = await createLegalEntity(identity, await request.json());
    return NextResponse.json({ legalEntity }, { status: 201 });
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
