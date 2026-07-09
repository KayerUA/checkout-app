import { NextRequest, NextResponse } from "next/server";
import { initPaymentForSession } from "@/lib/payments/service";
import { createBankInvoiceShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { ensureB2BInvoiceForCheckoutSession } from "@/lib/b2b/checkout";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.provider === "BANK_INVOICE") {
      const order = await createBankInvoiceShopifyOrderIdempotent(token);
      await ensureB2BInvoiceForCheckoutSession(token);
      return NextResponse.json({
        bankInvoice: true,
        orderName: order.shopifyOrderName,
        redirectUrl: `/checkout/${token}/thank-you`,
      });
    }
    const session = await prisma.checkoutSession.findUnique({ where: { publicToken: token } });
    const attrs = (session?.customAttributes ?? {}) as Record<string, unknown>;
    if (attrs.buyer_type === "fop_company") {
      return NextResponse.json(
        { error: "Для ФОП або компанії доступна тільки оплата за рахунком" },
        { status: 400 }
      );
    }
    const provider = body.provider === "LIQPAY" ? "LIQPAY" : "LIQPAY";
    const result = await initPaymentForSession(token, provider);
    return NextResponse.json({
      redirectUrl: result.redirectUrl,
      widgetData: result.widgetData,
      paymentAttemptId: result.attempt.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Payment init failed" },
      { status: 400 }
    );
  }
}
