import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { createShopifyOrderIdempotent } from "@/lib/shopify/order-writer";

export const runtime = "nodejs";

export async function POST() {
  try {
    await requireMerchantSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await prisma.checkoutSession.findMany({
    where: { status: "PAID", orderLink: null },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  const results = [];
  for (const session of pending) {
    try {
      const orderLink = await createShopifyOrderIdempotent(session.id);
      results.push({
        checkoutSessionId: session.id,
        publicToken: session.publicToken,
        sourceIdentifier: session.sourceIdentifier,
        status: "created",
        shopifyOrderName: orderLink.shopifyOrderName,
        shopifyOrderGid: orderLink.shopifyOrderGid,
      });
    } catch (error) {
      results.push({
        checkoutSessionId: session.id,
        publicToken: session.publicToken,
        sourceIdentifier: session.sourceIdentifier,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ checked: pending.length, results });
}
