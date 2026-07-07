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
import { normalizeB2BAttributes, validateFopFields } from "@/lib/b2b/attributes";
import {
  mergeCheckoutNoteAttributes,
  type NovaPoshtaShippingPayload,
} from "@/lib/shipping/shopify-np-note-attributes";
import type {
  CheckoutLine,
  CheckoutSession,
  Merchant,
  OrderLink,
  PaymentAttempt,
} from "@prisma/client";

async function findExistingOrderBySourceIdentifier(
  shopifySession: NonNullable<Awaited<ReturnType<typeof getMerchantShopifySession>>>,
  input: { sourceIdentifier: string; checkoutSessionId: string; publicToken: string }
) {
  try {
    const response = await shopifyAdminGraphQL<{
      data: {
        orders: {
          nodes: Array<{
            id: string;
            name: string;
            customAttributes: Array<{ key: string; value: string }>;
          }>;
        };
      };
    }>(
      shopifySession,
      `query FindExistingExternalCheckoutOrder($query: String!) {
        orders(first: 50, reverse: true, query: $query) {
          nodes {
            id
            name
            customAttributes { key value }
          }
        }
      }`,
      { query: "tag:external_checkout" }
    );

    return (
      response.data?.orders?.nodes?.find((order) => {
        const attrs = Object.fromEntries(
          order.customAttributes.map((attr) => [attr.key, attr.value])
        );
        return (
          attrs.checkout_session_id === input.checkoutSessionId ||
          attrs.checkout_public_token === input.publicToken ||
          attrs.source_identifier === input.sourceIdentifier
        );
      }) ?? null
    );
  } catch {
    return null;
  }
}

type SessionForOrder = CheckoutSession & {
  lines: CheckoutLine[];
  paymentAttempts: PaymentAttempt[];
  merchant: Merchant;
};

async function acquireOrderLinkPlaceholder(session: SessionForOrder): Promise<OrderLink> {
  try {
    return await prisma.orderLink.create({
      data: {
        checkoutSessionId: session.id,
        sourceIdentifier: session.sourceIdentifier,
        orderStatus: "CREATING",
      },
    });
  } catch (error) {
    const existing = await prisma.orderLink.findUnique({
      where: { checkoutSessionId: session.id },
    });

    if (!existing) throw error;
    if (existing.shopifyOrderGid) return existing;

    const ageMs = Date.now() - existing.createdAt.getTime();
    if (existing.orderStatus === "CREATING" && ageMs < 2 * 60 * 1000) {
      throw new Error("Shopify order creation already in progress");
    }

    return existing;
  }
}

async function finalizeOrderLink(params: {
  orderLinkId: string;
  checkoutSessionId: string;
  shopifyOrderGid: string;
  shopifyOrderName: string;
  orderStatus: string;
}) {
  const orderLink = await prisma.orderLink.update({
    where: { id: params.orderLinkId },
    data: {
      shopifyOrderGid: params.shopifyOrderGid,
      shopifyOrderName: params.shopifyOrderName,
      orderStatus: params.orderStatus,
    },
  });

  await prisma.checkoutSession.update({
    where: { id: params.checkoutSessionId },
    data: { status: "COMPLETED" },
  });

  return orderLink;
}

function buildBaseCheckoutNoteAttributes(
  session: SessionForOrder,
  paidAttempt: PaymentAttempt,
  extra: Array<{ name: string; value: string }> = []
) {
  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const ab = (attrs.ab ?? {}) as Record<string, string>;
  const base = [
    { name: "checkout_session_id", value: session.id },
    { name: "payment_provider", value: paidAttempt.provider },
    { name: "cod_enabled", value: "false" },
    ...extra,
  ];

  if (ab.experimentId) {
    base.push(
      { name: "ab_test", value: ab.experimentId },
      { name: "ab_variant", value: ab.variant ?? "" },
      { name: "ab_visitor_id", value: ab.visitorId ?? "" }
    );
  }

  return mergeCheckoutNoteAttributes(
    base,
    (session.shippingPayload ?? {}) as NovaPoshtaShippingPayload
  );
}

async function forwardPaidOrderToDiloshop(
  shopifySession: NonNullable<Awaited<ReturnType<typeof getMerchantShopifySession>>>,
  orderId: string,
  checkoutSessionId: string
) {
  try {
    const response = (await shopifyAdminREST(shopifySession, `orders/${orderId}.json`)) as {
      order: import("@/lib/b2b/types").ShopifyOrderPayload;
    };
    const { forwardExternalCheckoutOrderToDiloshop } = await import(
      "@/lib/accounting/diloshop-forward"
    );
    await forwardExternalCheckoutOrderToDiloshop({
      order: response.order,
      shopDomain: shopifySession.shop,
      checkoutSessionId,
    });
  } catch (error) {
    logWithCorrelation(
      "warn",
      "Diloshop forward failed after Shopify order create",
      { checkoutSessionId },
      { orderId, error: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function createShopifyOrderIdempotent(checkoutSessionId: string) {
  return withIdempotency("shopify-order", checkoutSessionId, async () => {
    const existing = await prisma.orderLink.findUnique({
      where: { checkoutSessionId },
    });
    if (existing?.shopifyOrderGid) return existing;
    if (existing?.orderStatus === "CREATING") {
      const ageMs = Date.now() - existing.createdAt.getTime();
      if (ageMs < 2 * 60 * 1000) {
        throw new Error("Shopify order creation already in progress");
      }
    }

    const session = await prisma.checkoutSession.findUniqueOrThrow({
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

    const placeholder = existing ?? (await acquireOrderLinkPlaceholder(session));
    if (placeholder.shopifyOrderGid) return placeholder;

    const sourceIdentifier = session.sourceIdentifier ?? session.id;
    const existingShopifyOrder = await findExistingOrderBySourceIdentifier(
      shopifySession,
      {
        sourceIdentifier,
        checkoutSessionId: session.id,
        publicToken: session.publicToken,
      }
    );

    if (existingShopifyOrder) {
      return finalizeOrderLink({
        orderLinkId: placeholder.id,
        checkoutSessionId: session.id,
        shopifyOrderGid: existingShopifyOrder.id,
        shopifyOrderName: existingShopifyOrder.name,
        orderStatus: "CREATED",
      });
    }

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

    // REST bridge for note_attributes. Diloshop/NP reads Chekly-compatible refs here.
    try {
      await shopifyAdminREST(shopifySession, `orders/${orderId}.json`, {
        method: "PUT",
        body: {
          order: {
            id: Number(orderId),
            note_attributes: buildBaseCheckoutNoteAttributes(session, paidAttempt),
          },
        },
      });
      await forwardPaidOrderToDiloshop(shopifySession, orderId, session.id);
    } catch {
      logWithCorrelation("warn", "note_attributes REST update failed", {
        checkoutSessionId,
        shopifyOrderGid: created.id,
      });
    }

    const orderLink = await finalizeOrderLink({
      orderLinkId: placeholder.id,
      checkoutSessionId: session.id,
      shopifyOrderGid: created.id,
      shopifyOrderName: created.name,
      orderStatus: "CREATED",
    });

    await prisma.merchant.update({
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

    try {
      const { sendPurchaseAnalytics } = await import("@/lib/analytics/server");
      await sendPurchaseAnalytics(session.merchantId, session, orderLink);
    } catch (error) {
      logWithCorrelation(
        "warn",
        "Purchase analytics failed",
        { checkoutSessionId },
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    logWithCorrelation("info", "Shopify order created", {
      checkoutSessionId,
      shopifyOrderGid: created.id,
      merchantId: session.merchantId,
    });

    const sessionAttrs = (session.customAttributes ?? {}) as Record<string, unknown>;
    const ab = (sessionAttrs.ab ?? {}) as Record<string, string>;
    if (ab.experimentId && ab.visitorId && ab.variant) {
      try {
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
      } catch (error) {
        logWithCorrelation(
          "warn",
          "Checkout AB event failed",
          { checkoutSessionId },
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }

    return orderLink;
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

      const attrs = normalizeB2BAttributes((session.customAttributes ?? {}) as Record<string, unknown>);
      if (attrs.buyer_type !== "fop_company" || attrs.payment_preference !== "bank_invoice") {
        throw new Error("Bank invoice order requires B2B/ФОП attributes");
      }
      validateFopFields(attrs);

      const shopifySession = await getMerchantShopifySession(session.merchantId);
      if (!shopifySession) throw new Error("Shopify session not found");

      const orderInput = mapCheckoutToOrderCreateInput(session, null, {
        financialStatus: "PENDING",
        sourceName: "ua_b2b_bank_invoice",
        includeShippingLines: false,
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
              note_attributes: mergeCheckoutNoteAttributes(
                [
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
                (session.shippingPayload ?? {}) as NovaPoshtaShippingPayload
              ),
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
