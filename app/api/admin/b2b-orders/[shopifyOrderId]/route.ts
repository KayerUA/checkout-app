import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { B2B_TAGS } from "@/lib/b2b/constants";
import { updateOrderTags } from "@/lib/shopify/b2b-admin";
import { sendDocumentEmail } from "@/lib/email/resend";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shopifyOrderId: string }> }
) {
  try {
    await requireMerchantSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { shopifyOrderId } = await params;
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const order = await prisma.b2BOrder.findUnique({ where: { shopifyOrderId } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "confirm_payment") {
    await prisma.b2BOrder.update({
      where: { shopifyOrderId },
      data: { status: "PAYMENT_CONFIRMED" },
    });
    await updateOrderTags({
      shopDomain: order.shopDomain,
      orderId: shopifyOrderId,
      add: [B2B_TAGS.paymentConfirmed, B2B_TAGS.bankTransferPaid],
      remove: [B2B_TAGS.waitingIbanPayment],
    });
  } else if (action === "needs_review") {
    await prisma.b2BOrder.update({
      where: { shopifyOrderId },
      data: { status: "NEEDS_REVIEW" },
    });
    await updateOrderTags({
      shopDomain: order.shopDomain,
      orderId: shopifyOrderId,
      add: [B2B_TAGS.needsPaymentReview],
    });
  } else if (action === "resend_invoice") {
    const invoice = await prisma.b2BDocument.findFirst({
      where: { shopifyOrderId, type: "invoice" },
      orderBy: { createdAt: "desc" },
    });
    if (!invoice || !order.docsEmail) {
      return NextResponse.json({ error: "Invoice or docs email missing" }, { status: 400 });
    }
    await sendDocumentEmail({
      to: order.docsEmail,
      subject: `Рахунок на оплату ${invoice.number} — KAYER UA`,
      html: `<p>Повторно надсилаємо рахунок на оплату.</p><p><a href="${invoice.pdfUrl}">${invoice.pdfUrl}</a></p>`,
    });
  }

  redirect("/admin/b2b-orders");
}
