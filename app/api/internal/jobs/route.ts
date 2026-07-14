import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

function authorize(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  return secret === getEnv().INTERNAL_JOBS_SECRET;
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await request.json();
  const { markAbandonedSessions } = await import("@/lib/checkout/session-service");
  const { createShopifyOrderIdempotent } = await import("@/lib/shopify/order-writer");
  const { fiscalizeOrder } = await import("@/lib/fiscal/checkbox");
  const { syncNovaPoshtaDictionary } = await import("@/lib/shipping/nova-poshta");
  const { prisma } = await import("@/lib/db");
  const { getPaymentAdapter } = await import("@/lib/payments");

  switch (job) {
    case "mark-abandoned": {
      const count = await markAbandonedSessions();
      return NextResponse.json({ count });
    }
    case "reconcile-orders": {
      const pending = await prisma.checkoutSession.findMany({
        where: { status: "PAID", orderLink: null },
        take: 20,
      });
      const results = [];
      for (const s of pending) {
        try {
          results.push(await createShopifyOrderIdempotent(s.id));
        } catch (e) {
          results.push({ error: String(e), sessionId: s.id });
        }
      }
      return NextResponse.json({ results });
    }
    case "reconcile-payments": {
      const attempts = await prisma.paymentAttempt.findMany({
        where: { status: "PENDING" },
        take: 20,
        include: { checkoutSession: { include: { merchant: { include: { paymentConfigs: true } } } } },
      });
      const results = [];
      for (const a of attempts) {
        const config = a.checkoutSession.merchant.paymentConfigs.find(
          (c) => c.provider === a.provider
        );
        if (!config || !a.providerReference) continue;
        const adapter = getPaymentAdapter(a.provider);
        if (!adapter.getFinalStatus) continue;
        const status = await adapter.getFinalStatus(
          a.providerReference,
          config.config as Record<string, string>
        );
        results.push({ id: a.id, status });
      }
      return NextResponse.json({ results });
    }
    case "reconcile-fiscal": {
      const pending = await prisma.fiscalReceipt.findMany({
        where: { status: { in: ["PENDING", "FAILED"] } },
        take: 20,
      });
      const results = [];
      for (const r of pending) {
        try {
          results.push(await fiscalizeOrder(r.orderLinkId));
        } catch (e) {
          results.push({ error: String(e), orderLinkId: r.orderLinkId });
        }
      }
      return NextResponse.json({ results });
    }
    case "sync-nova-poshta": {
      const result = await syncNovaPoshtaDictionary();
      return NextResponse.json(result);
    }
    default:
      return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }
}
