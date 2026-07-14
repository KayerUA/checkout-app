import { prisma } from "@/lib/db";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL, shopifyAdminREST } from "@/lib/shopify/admin";
import {
  mapCheckoutToOrderCreateInput,
  ORDER_CREATE_MUTATION,
} from "@/lib/shopify/order-mapper";
import { ensureSessionLinePricing } from "@/lib/checkout/session-service";
import { enqueueJob, QUEUE_NAMES } from "@/lib/queue";
import { logWithCorrelation } from "@/lib/logger";
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

const ORDER_CREATION_LEASE_MS = 2 * 60 * 1000;

async function claimOrderLink(session: SessionForOrder): Promise<OrderLink> {
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

    const now = new Date();
    const claimable = existing.orderStatus === "CREATING"
      ? { orderStatus: "CREATING", updatedAt: { lt: new Date(now.getTime() - ORDER_CREATION_LEASE_MS) } }
      : { orderStatus: { not: "CREATING" } };
    const claimed = await prisma.orderLink.updateMany({
      where: { id: existing.id, shopifyOrderGid: null, ...claimable },
      data: { orderStatus: "CREATING" },
    });
    if (claimed.count !== 1) {
      throw new Error("Shopify order creation already in progress");
    }
    return prisma.orderLink.findUniqueOrThrow({ where: { id: existing.id } });
  }
}

async function markOrderLinkCreationFailed(orderLinkId: string) {
  await prisma.orderLink.updateMany({
    where: { id: orderLinkId, shopifyOrderGid: null },
    data: { orderStatus: "CREATION_FAILED" },
  });
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

async function dispatchNovaPoshtaFallback(
  shopifySession: NonNullable<Awaited<ReturnType<typeof getMerchantShopifySession>>>,
  input: {
    checkoutSessionId: string;
    shopifyOrderGid: string;
  }
) {
  const orderId = input.shopifyOrderGid.replace("gid://shopify/Order/", "");

  try {
    const {
      isDiloshopNovaPoshtaFallbackConfigured,
      notifyDiloshopNovaPoshtaFallback,
    } = await import("@/lib/shipping/diloshop-np-fallback");
    if (!isDiloshopNovaPoshtaFallbackConfigured()) return;

    const response = (await shopifyAdminREST(shopifySession, `orders/${orderId}.json`)) as {
      order: import("@/lib/b2b/types").ShopifyOrderPayload;
    };
    await notifyDiloshopNovaPoshtaFallback({
      order: response.order,
      shopDomain: shopifySession.shop,
      checkoutSessionId: input.checkoutSessionId,
    });
  } catch (error) {
    logWithCorrelation(
      "warn",
      "Diloshop Nova Poshta fallback failed after Shopify order create",
      {
        checkoutSessionId: input.checkoutSessionId,
        shopifyOrderGid: input.shopifyOrderGid,
      },
      { orderId, error: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function createShopifyOrderIdempotent(checkoutSessionId: string) {
    const session = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: checkoutSessionId },
      include: {
        lines: true,
        paymentAttempts: true,
        merchant: true,
      },
    });

    await ensureSessionLinePricing(session.publicToken);
    const pricedSession = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: checkoutSessionId },
      include: {
        lines: true,
        paymentAttempts: true,
        merchant: true,
      },
    });

    const paidAttempt = pricedSession.paymentAttempts.find((a) => a.status === "PAID");
    if (!paidAttempt) throw new Error("No successful payment attempt");

    const shopifySession = await getMerchantShopifySession(session.merchantId);
    if (!shopifySession) throw new Error("Shopify session not found");

    const placeholder = await claimOrderLink(session);
    if (placeholder.shopifyOrderGid) {
      await dispatchNovaPoshtaFallback(shopifySession, {
        checkoutSessionId: session.id,
        shopifyOrderGid: placeholder.shopifyOrderGid,
      });
      return placeholder;
    }

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
      const orderLink = await finalizeOrderLink({
        orderLinkId: placeholder.id,
        checkoutSessionId: session.id,
        shopifyOrderGid: existingShopifyOrder.id,
        shopifyOrderName: existingShopifyOrder.name,
        orderStatus: "CREATED",
      });
      await dispatchNovaPoshtaFallback(shopifySession, {
        checkoutSessionId: session.id,
        shopifyOrderGid: existingShopifyOrder.id,
      });
      return orderLink;
    }

    const orderInput = mapCheckoutToOrderCreateInput(pricedSession, paidAttempt, {
      includeShippingLines: true,
    });
    let response: Awaited<ReturnType<typeof shopifyAdminGraphQL<{
      data: {
        orderCreate: {
          userErrors: Array<{ field: string; message: string }>;
          order: { id: string; name: string };
        };
      };
    }>>>;
    try {
      response = await shopifyAdminGraphQL<{
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
    } catch (error) {
      await markOrderLinkCreationFailed(placeholder.id);
      throw error;
    }

    const errors = response.data?.orderCreate?.userErrors;
    if (errors?.length) {
      await markOrderLinkCreationFailed(placeholder.id);
      throw new Error(JSON.stringify(errors));
    }

    const created = response.data.orderCreate.order;
    const orderId = created.id.replace("gid://shopify/Order/", "");

    // REST bridge for note_attributes. Diloshop/NP reads Chekly-compatible refs here.
    try {
      await shopifyAdminREST(shopifySession, `orders/${orderId}.json`, {
        method: "PUT",
        body: {
          order: {
            id: Number(orderId),
            note_attributes: buildBaseCheckoutNoteAttributes(pricedSession, paidAttempt),
          },
        },
      });
    } catch (error) {
      logWithCorrelation(
        "warn",
        "note_attributes REST update failed",
        { checkoutSessionId, shopifyOrderGid: created.id },
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    const orderLink = await finalizeOrderLink({
      orderLinkId: placeholder.id,
      checkoutSessionId: session.id,
      shopifyOrderGid: created.id,
      shopifyOrderName: created.name,
      orderStatus: "CREATED",
    });

    await dispatchNovaPoshtaFallback(shopifySession, {
      checkoutSessionId: session.id,
      shopifyOrderGid: created.id,
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
}

export async function createBankInvoiceShopifyOrderIdempotent(publicToken: string) {
  await ensureSessionLinePricing(publicToken);
  const session = await prisma.checkoutSession.findUniqueOrThrow({
    where: { publicToken },
    include: { lines: true, paymentAttempts: true, merchant: true },
  });
  const attrs = normalizeB2BAttributes((session.customAttributes ?? {}) as Record<string, unknown>);
  if (attrs.buyer_type !== "fop_company" || attrs.payment_preference !== "bank_invoice") {
    throw new Error("Bank invoice order requires B2B/ФОП attributes");
  }
  validateFopFields(attrs);

  const shopifySession = await getMerchantShopifySession(session.merchantId);
  if (!shopifySession) throw new Error("Shopify session not found");

  const placeholder = await claimOrderLink(session);
  if (placeholder.shopifyOrderGid) return placeholder;

  const existingShopifyOrder = await findExistingOrderBySourceIdentifier(shopifySession, {
    sourceIdentifier: session.sourceIdentifier ?? session.id,
    checkoutSessionId: session.id,
    publicToken: session.publicToken,
  });
  if (existingShopifyOrder) {
    return finalizeOrderLink({
      orderLinkId: placeholder.id,
      checkoutSessionId: session.id,
      shopifyOrderGid: existingShopifyOrder.id,
      shopifyOrderName: existingShopifyOrder.name,
      orderStatus: "WAITING_BANK_PAYMENT",
    });
  }

  const orderInput = mapCheckoutToOrderCreateInput(session, null, {
    financialStatus: "PENDING",
    sourceName: "ua_b2b_bank_invoice",
    includeShippingLines: true,
  });
  let response: { data?: { orderCreate?: { userErrors: Array<{ field: string; message: string }>; order: { id: string; name: string } } } };
  try {
    response = await shopifyAdminGraphQL<typeof response>(shopifySession, ORDER_CREATE_MUTATION, {
      order: orderInput,
      options: { inventoryBehaviour: "BYPASS", sendReceipt: false, sendFulfillmentReceipt: false },
    });
  } catch (error) {
    await markOrderLinkCreationFailed(placeholder.id);
    throw error;
  }

  const errors = response.data?.orderCreate?.userErrors;
  if (errors?.length || !response.data?.orderCreate?.order) {
    await markOrderLinkCreationFailed(placeholder.id);
    throw new Error(errors?.map((error) => error.message).join("; ") || "Shopify order creation failed");
  }
  const created = response.data.orderCreate.order;
  const orderLink = await finalizeOrderLink({
    orderLinkId: placeholder.id,
    checkoutSessionId: session.id,
    shopifyOrderGid: created.id,
    shopifyOrderName: created.name,
    orderStatus: "WAITING_BANK_PAYMENT",
  });
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

  logWithCorrelation("info", "Shopify B2B bank invoice order created", {
    checkoutSessionId: session.id,
    shopifyOrderGid: created.id,
    merchantId: session.merchantId,
  });
  return orderLink;
}
