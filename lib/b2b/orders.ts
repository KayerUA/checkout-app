import { prisma } from "@/lib/db";
import { getB2BAttributesFromOrder, validateFopFields } from "@/lib/b2b/attributes";
import { B2B_TAGS } from "@/lib/b2b/constants";
import { writeAutomationLog } from "@/lib/b2b/log";
import { getOrCreateInvoiceDocument } from "@/lib/documents/invoice";
import { getOrCreateDeliveryNoteDocument } from "@/lib/documents/delivery-note";
import { publicInvoiceUrl } from "@/lib/documents/public-invoice-link";
import { sendDocumentEmail } from "@/lib/email/resend";
import {
  renderDeliveryNoteEmailHtml,
  renderInvoiceEmailHtml,
  renderInvoiceEmailText,
} from "@/lib/email/document-templates";
import { sendOrderInvoiceEmail, setOrderMetafields, updateOrderTags } from "@/lib/shopify/b2b-admin";
import type { FopOrderAttributes, ShopifyOrderPayload } from "@/lib/b2b/types";
import type { Prisma } from "@prisma/client";

function shopDomainFromOrder(order: ShopifyOrderPayload, fallback?: string | null) {
  return order.myshopify_domain ?? order.shop_domain ?? fallback ?? undefined;
}

export async function upsertB2BOrder(order: ShopifyOrderPayload, buyer: FopOrderAttributes, status: string) {
  return prisma.b2BOrder.upsert({
    where: { shopifyOrderId: String(order.id) },
    create: {
      shopifyOrderId: String(order.id),
      shopifyOrderName: order.name,
      shopDomain: shopDomainFromOrder(order),
      buyerType: buyer.buyer_type,
      paymentPreference: buyer.payment_preference,
      fopName: buyer.fop_name,
      fopTaxId: buyer.fop_tax_id,
      fopLegalAddress: buyer.fop_legal_address,
      docsEmail: buyer.docs_email ?? order.email ?? order.contact_email,
      docsPhone: buyer.docs_phone ?? order.phone ?? order.billing_address?.phone ?? order.shipping_address?.phone,
      accountingComment: buyer.accounting_comment,
      legalEntityId: buyer.legal_entity_id,
      legalEntitySnapshot: buyer.legal_entity_snapshot as Prisma.InputJsonValue | undefined,
      orderTotalAmount: Number(order.total_price ?? 0),
      orderCurrency: order.currency ?? "UAH",
      status,
    },
    update: {
      shopifyOrderName: order.name,
      shopDomain: shopDomainFromOrder(order),
      buyerType: buyer.buyer_type,
      paymentPreference: buyer.payment_preference,
      fopName: buyer.fop_name,
      fopTaxId: buyer.fop_tax_id,
      fopLegalAddress: buyer.fop_legal_address,
      docsEmail: buyer.docs_email ?? order.email ?? order.contact_email,
      docsPhone: buyer.docs_phone ?? order.phone ?? order.billing_address?.phone ?? order.shipping_address?.phone,
      accountingComment: buyer.accounting_comment,
      orderTotalAmount: Number(order.total_price ?? 0),
      orderCurrency: order.currency ?? "UAH",
      status,
    },
  });
}

export async function handleB2BOrderCreated(order: ShopifyOrderPayload, shopDomain?: string | null) {
  const buyer = getB2BAttributesFromOrder(order);
  if (buyer.buyer_type !== "fop_company") {
    await writeAutomationLog({
      shopifyOrderId: String(order.id),
      eventType: "orders/create",
      step: "skip_non_b2b",
      status: "OK",
      message: "Non-B2B order ignored",
    });
    return { skipped: true };
  }

  validateFopFields(buyer);
  const orderShop = shopDomainFromOrder(order, shopDomain);
  await updateOrderTags({ shopDomain: orderShop, orderId: String(order.id), add: [B2B_TAGS.b2bFop] });
  await setOrderMetafields({
    shopDomain: orderShop,
    orderId: String(order.id),
    metafields: {
      buyer_type: buyer.buyer_type,
      payment_preference: buyer.payment_preference,
      fop_name: buyer.fop_name,
      fop_tax_id: buyer.fop_tax_id,
      docs_email: buyer.docs_email,
      docs_phone: buyer.docs_phone,
      automation_status: "CREATED",
    },
  });

  if (buyer.payment_preference === "card") {
    await upsertB2BOrder(order, buyer, "NEEDS_REVIEW");
    await updateOrderTags({
      shopDomain: orderShop,
      orderId: String(order.id),
      add: [B2B_TAGS.b2bCardPayment, B2B_TAGS.cardPaidNeedsReview],
    });
    await setOrderMetafields({
      shopDomain: orderShop,
      orderId: String(order.id),
      metafields: {
        bank_payment_status: "CARD_PAID_NEEDS_ACCOUNTING_REVIEW",
        automation_status: "NEEDS_REVIEW",
      },
    });
    return { skippedInvoice: true };
  }

  await upsertB2BOrder(order, buyer, "CREATED");
  const invoice = await getOrCreateInvoiceDocument(order, buyer, orderShop);
  const invoiceDownloadUrl = publicInvoiceUrl(invoice.document.id);
  await prisma.b2BOrder.update({
    where: { shopifyOrderId: String(order.id) },
    data: { status: "WAITING_BANK_PAYMENT" },
  });

  await setOrderMetafields({
    shopDomain: orderShop,
    orderId: String(order.id),
    metafields: {
      invoice_number: invoice.document.number,
      invoice_pdf_url: invoiceDownloadUrl,
      bank_payment_status: "WAITING_BANK_PAYMENT",
      automation_status: "WAITING_BANK_PAYMENT",
    },
  });
  await updateOrderTags({
    shopDomain: orderShop,
    orderId: String(order.id),
    add: [B2B_TAGS.invoiceSent, B2B_TAGS.waitingIbanPayment],
  });

  if (invoice.created && buyer.docs_email) {
    await sendInvoiceEmail({
      shopDomain: orderShop,
      orderId: String(order.id),
      to: buyer.docs_email,
      invoiceNumber: invoice.document.number ?? "",
      orderName: order.name,
      paymentPurpose: invoice.paymentPurpose,
      pdfUrl: invoiceDownloadUrl,
      pdf: invoice.pdf,
    });
  }

  await writeAutomationLog({
    shopifyOrderId: String(order.id),
    eventType: "orders/create",
    step: "invoice_sent",
    status: "OK",
    message: "B2B invoice created",
    metadata: { invoiceNumber: invoice.document.number },
  });
  return { invoice };
}

async function sendInvoiceEmail(input: {
  shopDomain?: string | null;
  orderId: string;
  to: string;
  invoiceNumber: string;
  orderName?: string | null;
  paymentPurpose: string;
  pdfUrl?: string | null;
  pdf?: Buffer | null;
}) {
  const subject = `Рахунок ${input.invoiceNumber} готовий до оплати - KAYER UA`;
  const fallbackMessage = [
      "Дякуємо за замовлення.",
      "Ви обрали оплату як ФОП або компанія.",
      "Оплата виконується лише за реквізитами з PDF-рахунку.",
      "Не використовуйте кнопку Shopify «Оплатити зараз» у цьому листі.",
      `Призначення платежу: ${input.paymentPurpose}`,
      input.pdfUrl ? `Завантажити рахунок PDF: ${input.pdfUrl}` : "",
      "Після надходження коштів замовлення буде автоматично передано в обробку.",
    ]
      .filter(Boolean)
      .join("\n\n");

  try {
    const result = await sendDocumentEmail({
      to: input.to,
      subject,
      html: renderInvoiceEmailHtml(input),
      text: renderInvoiceEmailText(input),
      attachments: input.pdf
        ? [{ filename: `${input.invoiceNumber}.pdf`, content: input.pdf, contentType: "application/pdf" }]
        : undefined,
    });
    if (!("skipped" in result && result.skipped)) return;
  } catch (error) {
    await writeAutomationLog({
      shopifyOrderId: input.orderId,
      eventType: "invoice_email",
      step: "styled_invoice_email",
      status: "WARN",
      message: "Styled invoice email failed, falling back to Shopify order invoice email",
      error,
    }).catch(() => {});
  }

  await sendOrderInvoiceEmail({
    shopDomain: input.shopDomain,
    orderId: input.orderId,
    to: input.to,
    subject,
    customMessage: fallbackMessage,
  });
}

export async function handleB2BOrderPaid(order: ShopifyOrderPayload, shopDomain?: string | null) {
  const buyer = getB2BAttributesFromOrder(order);
  if (buyer.buyer_type !== "fop_company") return { skipped: true };

  if (buyer.payment_preference === "card") {
    await upsertB2BOrder(order, buyer, "NEEDS_REVIEW");
    await updateOrderTags({
      shopDomain: shopDomainFromOrder(order, shopDomain),
      orderId: String(order.id),
      add: [B2B_TAGS.cardPaidNeedsReview, B2B_TAGS.b2bCardPayment],
    });
    await writeAutomationLog({
      shopifyOrderId: String(order.id),
      eventType: "orders/paid",
      step: "card_paid_review",
      status: "WARN",
      message: "Company card payment needs accounting review",
    });
  } else {
    await writeAutomationLog({
      shopifyOrderId: String(order.id),
      eventType: "orders/paid",
      step: "manual_paid_seen",
      status: "WARN",
      message: "Shopify marked a bank invoice order as paid before bank reconciliation",
    });
  }
  return { ok: true };
}

export async function handleB2BOrderCancelled(order: ShopifyOrderPayload, shopDomain?: string | null) {
  const existing = await prisma.b2BOrder.findUnique({ where: { shopifyOrderId: String(order.id) } });
  if (!existing) return { skipped: true };
  await prisma.b2BOrder.update({ where: { shopifyOrderId: String(order.id) }, data: { status: "CANCELLED" } });
  await updateOrderTags({
    shopDomain: shopDomainFromOrder(order, shopDomain),
    orderId: String(order.id),
    add: [B2B_TAGS.cancelled],
  });
  return { ok: true };
}

export async function createPostPaymentDocuments(input: {
  order: ShopifyOrderPayload;
  buyer: FopOrderAttributes;
  invoiceNumber: string;
  transactionId: string;
  shopDomain?: string | null;
  paymentStatus: "PAID" | "PAID_WITH_OVERPAYMENT";
  paidAmount: number;
  remainingAmount: number;
  overpaymentAmount: number;
}) {
  const existingDocsSent = await prisma.b2BOrder.findUnique({
    where: { shopifyOrderId: String(input.order.id) },
  });
  if (existingDocsSent?.status === "DOCS_SENT" || existingDocsSent?.status === "READY_TO_FULFILL_AFTER_BANK_PAYMENT") {
    return { skipped: true };
  }

  const note = await getOrCreateDeliveryNoteDocument({
    order: input.order,
    buyer: input.buyer,
    invoiceNumber: input.invoiceNumber,
  });
  const docsEmail = input.buyer.docs_email ?? input.order.email ?? input.order.contact_email;
  if (note.created && docsEmail) {
    await sendDocumentEmail({
      to: docsEmail,
      subject: `Оплату отримано — документи KAYER UA`,
      html: renderDeliveryNoteEmailHtml({
        documentNumber: note.document.number,
        orderName: input.order.name,
        pdfUrl: note.document.pdfUrl,
      }),
      attachments: note.pdf
        ? [{ filename: `${note.document.number}.pdf`, content: note.pdf, contentType: "application/pdf" }]
        : undefined,
    });
  }

  await prisma.b2BOrder.update({
    where: { shopifyOrderId: String(input.order.id) },
    data: { status: "READY_TO_FULFILL_AFTER_BANK_PAYMENT" },
  });
  await updateOrderTags({
    shopDomain: shopDomainFromOrder(input.order, input.shopDomain),
    orderId: String(input.order.id),
    add: [B2B_TAGS.paymentConfirmed, B2B_TAGS.deliveryNoteCreated, B2B_TAGS.docsSent],
  });
  await setOrderMetafields({
    shopDomain: shopDomainFromOrder(input.order, input.shopDomain),
    orderId: String(input.order.id),
    metafields: {
      delivery_note_pdf_url: note.document.pdfUrl,
      bank_payment_status: input.paymentStatus,
      paid_amount_uah: input.paidAmount.toFixed(2),
      remaining_amount_uah: input.remainingAmount.toFixed(2),
      overpayment_amount_uah: input.overpaymentAmount.toFixed(2),
      bank_transaction_id: input.transactionId,
      automation_status: "READY_TO_FULFILL_AFTER_BANK_PAYMENT",
    },
  });
  return { document: note.document };
}
