import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await requireMerchantSession();
  const merchant = await prisma.merchant.findUnique({
    where: { id: session.merchantId },
    select: { plan: true, paidOrdersCount: true },
  });
  return NextResponse.json({
    plan: merchant?.plan ?? "launch",
    paidOrdersCount: merchant?.paidOrdersCount ?? 0,
    pricing: {
      launch: { monthly: 19, perOrder: 0.25, cap: 89 },
      growth: { monthly: 29, gmvPercent: 0.45, cap: 249 },
      scale: { monthly: 79, gmvPercent: 0.2 },
    },
  });
}

export async function PATCH(request: NextRequest) {
  const session = await requireMerchantSession();
  const { plan } = await request.json();
  await prisma.merchant.update({
    where: { id: session.merchantId },
    data: { plan },
  });
  return NextResponse.json({ ok: true });
}
