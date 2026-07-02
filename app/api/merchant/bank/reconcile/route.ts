import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { reconcileBankPayments } from "@/lib/reconciliation/service";
import { createAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireMerchantSession();
    const days = Number(request.nextUrl.searchParams.get("days") ?? 7);
    const to = new Date();
    const from = new Date(Date.now() - Math.max(1, Math.min(days, 31)) * 24 * 60 * 60 * 1000);
    const result = await reconcileBankPayments({ from, to });

    await createAuditLog({
      merchantId: session.merchantId,
      action: "bank.reconcile_manual_run",
      entityType: "BankPayment",
      metadata: {
        checked: result.checked,
        days: Math.max(1, Math.min(days, 31)),
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bank reconciliation failed" },
      { status: 500 }
    );
  }
}
