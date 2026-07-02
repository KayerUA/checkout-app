import { prisma } from "@/lib/db";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL, shopifyAdminREST } from "@/lib/shopify/admin";
import {
  mapCheckoutToOrderCreateInput,
  ORDER_CREATE_MUTATION,
} from "@/lib/shopify/order-mapper";
import { enqueueJob, QUEUE_NAMES } from "@/lib/queue";
import { logWithCorrelation } from "@/lib/logger";
import { withIdempotency } from "@/lib/idempotency";

export async function createShopifyOrderIdempotent(checkoutSessionId: string) {
  return withIdempotency("shopify-order", checkoutSessionId, async () => {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.orderLink.findUnique({
        where: { checkoutSessionId },
      });
      if (existing?.shopifyOrderGid) return existing;

      const session = await tx.checkoutSession.findUniqueOrThrow({
        where: { id: checkoutSessionId },
        include: {
          lines: true,
          paymentAttempts: true,
          merchant: true,
        },
      });

      const paidAttempt = session.paymentAttempts.find((a) => a.status === "PAID");
      if (!paidAttempt) throw new Error("No successful payment attempt");

      const shopifySession = await getMerchantShopifySession(session.merchantId);
      if (!shopifySession) throw new Error("Shopify session not found");

      const orderInput = mapCheckoutToOrderCreateInput(session, paidAttempt);

      const response = await shopifyAdminGraphQL<{
        data: {
          orderCreate: {
            userErrors: Array<{ field: string; message: string }>;
            order: { id: string; name: string };
          };
        };
      }>(shopifySession, ORDER_CREATE_MUTATION, {
        order: orderInput,
        options: {
          inventoryBehaviour: "BYPASS",
          sendReceipt: false,
          sendFulfillmentReceipt: false,
        },
      });

      const errors = response.data?.orderCreate?.userErrors;
      if (errors?.length) throw new Error(JSON.stringify(errors));

      const created = response.data.orderCreate.order;
      const orderId = created.id.replace("gid://shopify/Order/", "");

      // REST bridge for note_attributes
      try {
        await shopifyAdminREST(shopifySession, `orders/${orderId}.json`, {
          method: "PUT",
          body: {
            order: {
              id: Number(orderId),
              note_attributes: [
                { name: "checkout_session_id", value: session.id },
                { name: "payment_provider", value: paidAttempt.provider },
                { name: "cod_enabled", value: "false" },
                ...(() => {
                  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
                  const ab = (attrs.ab ?? {}) as Record<string, string>;
                  if (!ab.experimentId) return [];
                  return [
                    { name: "ab_test", value: ab.experimentId },
                    { name: "ab_variant", value: ab.variant ?? "" },
                    { name: "ab_visitor_id", value: ab.visitorId ?? "" },
                  ];
                })(),
              ],
            },
          },
        });
      } catch {
        logWithCorrelation("warn", "note_attributes REST update failed", {
          checkoutSessionId,
          shopifyOrderGid: created.id,
        });
      }

      const orderLink = await tx.orderLink.create({
        data: {
          checkoutSessionId: session.id,
          shopifyOrderGid: created.id,
          shopifyOrderName: created.name,
          sourceIdentifier: session.sourceIdentifier,
          orderStatus: "CREATED",
        },
      });

      await tx.checkoutSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED" },
      });

      await tx.merchant.update({
        where: { id: session.merchantId },
        data: { paidOrdersCount: { increment: 1 } },
      });

      try {
        await enqueueJob(QUEUE_NAMES.FISCAL, "fiscalize-order", {
          orderLinkId: orderLink.id,
        });
      } catch (error) {
        logWithCorrelation(
          "warn",
          "Fiscal queue unavailable, skipping async fiscalization",
          { checkoutSessionId },
          {
            orderLinkId: orderLink.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      const { sendPurchaseAnalytics } = await import("@/lib/analytics/server");
      await sendPurchaseAnalytics(session.merchantId, session, orderLink);

      logWithCorrelation("info", "Shopify order created", {
        checkoutSessionId,
        shopifyOrderGid: created.id,
        merchantId: session.merchantId,
      });

      const sessionAttrs = (session.customAttributes ?? {}) as Record<string, unknown>;
      const ab = (sessionAttrs.ab ?? {}) as Record<string, string>;
      if (ab.experimentId && ab.visitorId && ab.variant) {
        const { logCheckoutAbEvent } = await import("@/lib/checkout-ab/events");
        await logCheckoutAbEvent({
          experimentId: ab.experimentId,
          visitorId: ab.visitorId,
          variant: ab.variant,
          eventName: "shopify_order_created",
          checkoutSessionId: session.id,
          shopifyOrderId: created.id,
          revenue: session.totalAmount / 100,
          currency: session.currency,
          email: session.buyerEmail,
          phone: session.buyerPhone,
          payload: { shopifyOrderName: created.name },
        });
      }

      return orderLink;
    });
  });
}

export async function createBankInvoiceShopifyOrderIdempotent(publicToken: string) {
  return withIdempotency("shopify-bank-invoice-order", publicToken, async () => {
    return prisma.$transaction(async (tx) => {
      const session = await tx.checkoutSession.findUniqueOrThrow({
        where: { publicToken },
        include: {
          lines: true,
          paymentAttempts: true,
          merchant: true,
          orderLink: true,
        },
      });
      if (session.orderLink?.shopifyOrderGid) return session.orderLink;

      const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
      if (attrs.buyer_type !== "fop_company" || attrs.payment_preference !== "bank_invoice") {
        throw new Error("Bank invoice order requires B2B/FOP attributes");
      }

      const shopifySession = await getMerchantShopifySession(session.merchantId);
      if (!shopifySession) throw new Error("Shopify session not found");

      const orderInput = mapCheckoutToOrderCreateInput(session, null, {
        financialStatus: "PENDING",
        sourceName: "ua_b2b_bank_invoice",
      });

      const response = await shopifyAdminGraphQL<{
        data: {
          orderCreate: {
            userErrors: Array<{ field: string; message: string }>;
            order: { id: string; name: string };
          };
        };
      }>(shopifySession, ORDER_CREATE_MUTATION, {
        order: orderInput,
        options: {
          inventoryBehaviour: "BYPASS",
          sendReceipt: false,
          sendFulfillmentReceipt: false,
        },
      });

      const errors = response.data?.orderCreate?.userErrors;
      if (errors?.length) throw new Error(JSON.stringify(errors));
      const created = response.data.orderCreate.order;
      const orderId = created.id.replace("gid://shopify/Order/", "");

      try {
        await shopifyAdminREST(shopifySession, `orders/${orderId}.json`, {
          method: "PUT",
          body: {
            order: {
              id: Number(orderId),
              note_attributes: [
                { name: "checkout_session_id", value: session.id },
                { name: "payment_provider", value: "BANK_INVOICE" },
                { name: "buyer_type", value: "fop_company" },
                { name: "payment_preference", value: "bank_invoice" },
                { name: "fop_name", value: String(attrs.fop_name ?? "") },
                { name: "fop_tax_id", value: String(attrs.fop_tax_id ?? "") },
                { name: "fop_legal_address", value: String(attrs.fop_legal_address ?? "") },
                { name: "docs_email", value: String(attrs.docs_email ?? session.buyerEmail ?? "") },
                { name: "docs_phone", value: String(attrs.docs_phone ?? session.buyerPhone ?? "") },
                { name: "accounting_comment", value: String(attrs.accounting_comment ?? "") },
              ],
            },
          },
        });
      } catch {
        logWithCorrelation("warn", "B2B note_attributes REST update failed", {
          checkoutSessionId: session.id,
          shopifyOrderGid: created.id,
        });
      }

      const orderLink = await tx.orderLink.create({
        data: {
          checkoutSessionId: session.id,
          shopifyOrderGid: created.id,
          shopifyOrderName: created.name,
          sourceIdentifier: session.sourceIdentifier,
          orderStatus: "WAITING_BANK_PAYMENT",
        },
      });

      await tx.checkoutSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", paymentProvider: "BANK_INVOICE" },
      });

      logWithCorrelation("info", "Shopify B2B bank invoice order created", {
        checkoutSessionId: session.id,
        shopifyOrderGid: created.id,
        merchantId: session.merchantId,
      });

      return orderLink;
    });
  });
}
