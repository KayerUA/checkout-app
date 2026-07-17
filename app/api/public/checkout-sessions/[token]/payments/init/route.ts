import { NextRequest, NextResponse } from "next/server";
import { initPaymentForSession } from "@/lib/payments/service";
import { createBankInvoiceShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { ensureB2BInvoiceForCheckoutSession } from "@/lib/b2b/checkout";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiErrorResponse } from "@/lib/api/errors";
import { requiredCheckoutEmailSchema } from "@/lib/checkout/public-input";

const bodySchema = z.object({
  provider: z.enum(["LIQPAY", "BANK_INVOICE"]),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const rate = await checkRateLimit(
      request,
      { name: "payment-init", limit: 10, windowSeconds: 15 * 60 },
      token
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many payment attempts" },
        { status: 429, headers: rateLimitHeaders(rate) }
      );
    }
    const body = bodySchema.parse(await request.json());
    const session = await prisma.checkoutSession.findUnique({ where: { publicToken: token } });
    if (!session) {
      return NextResponse.json({ error: "Сесію оформлення не знайдено" }, { status: 404 });
    }
    if (!requiredCheckoutEmailSchema.safeParse(session.buyerEmail).success) {
      return NextResponse.json(
        { error: "Вкажіть коректний email, щоб оформити замовлення" },
        { status: 400 }
      );
    }
    if (body.provider === "BANK_INVOICE") {
      const order = await createBankInvoiceShopifyOrderIdempotent(token);
      await ensureB2BInvoiceForCheckoutSession(token);
      return NextResponse.json({
        bankInvoice: true,
        orderName: order.shopifyOrderName,
        redirectUrl: `/checkout/${token}/thank-you`,
      });
    }
    const attrs = (session?.customAttributes ?? {}) as Record<string, unknown>;
    if (attrs.buyer_type === "fop_company") {
      return NextResponse.json(
        { error: "Для ФОП або компанії доступна тільки оплата за рахунком" },
        { status: 400 }
      );
    }
    const result = await initPaymentForSession(token, "LIQPAY");
    return NextResponse.json({
      redirectUrl: result.redirectUrl,
      widgetData: result.widgetData,
      paymentAttemptId: result.attempt.id,
    });
  } catch (error) {
    return apiErrorResponse(error, "Payment initialization failed");
  }
}
