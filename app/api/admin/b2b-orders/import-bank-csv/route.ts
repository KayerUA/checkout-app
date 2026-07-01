import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { ManualImportCsvProvider } from "@/lib/bank/csv-provider";
import { reconcileBankTransactions } from "@/lib/reconciliation/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const env = getEnv();
  const expected = env.INTERNAL_JOBS_SECRET;
  const provided = request.headers.get("x-internal-secret");
  if (expected && provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const csv = await request.text();
  const now = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const provider = new ManualImportCsvProvider(csv);
  const transactions = await provider.fetchTransactions(from, now);
  const result = await reconcileBankTransactions(transactions, { from, to: now });
  return NextResponse.json(result);
}
