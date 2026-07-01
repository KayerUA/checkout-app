import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { syncNovaPoshtaDictionary } from "@/lib/shipping/nova-poshta";

export async function POST() {
  try {
    await requireMerchantSession();
    const result = await syncNovaPoshtaDictionary();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
