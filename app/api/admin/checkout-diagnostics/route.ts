import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireMerchantSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const where = q
    ? {
        OR: [
          { publicToken: { contains: q } },
          { sourceIdentifier: { contains: q } },
          { buyerEmail: { contains: q } },
          { buyerPhone: { contains: q } },
          { paymentAttempts: { some: { providerReference: { contains: q } } } },
          { orderLink: { shopifyOrderName: { contains: q } } },
        ],
      }
    : {};

  const sessions = await prisma.checkoutSession.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q ? 20 : 10,
    include: {
      lines: true,
      paymentAttempts: { orderBy: { createdAt: "desc" } },
      orderLink: true,
    },
  });

  return NextResponse.json({
    count: sessions.length,
    sessions: sessions.map((session) => ({
      id: session.id,
      publicToken: session.publicToken,
      sourceIdentifier: session.sourceIdentifier,
      status: session.status,
      totalAmount: session.totalAmount,
      currency: session.currency,
      buyerEmail: session.buyerEmail,
      buyerPhone: session.buyerPhone,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      orderLink: session.orderLink
        ? {
            shopifyOrderName: session.orderLink.shopifyOrderName,
            shopifyOrderGid: session.orderLink.shopifyOrderGid,
            orderStatus: session.orderLink.orderStatus,
          }
        : null,
      payments: session.paymentAttempts.map((payment) => ({
        provider: payment.provider,
        status: payment.status,
        providerReference: payment.providerReference,
        amount: payment.amount,
        verifiedAt: payment.verifiedAt,
        modifiedAtProvider: payment.modifiedAtProvider,
        createdAt: payment.createdAt,
        callbackPayload: payment.callbackPayload,
      })),
      lines: session.lines.map((line) => ({
        title: line.title,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    })),
  });
}
