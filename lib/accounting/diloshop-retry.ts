import { writeAutomationLog } from "@/lib/b2b/log";
import { prisma } from "@/lib/db";
import { forwardExternalCheckoutOrderToDiloshop } from "@/lib/accounting/diloshop-forward";
import { shopifyAdminREST } from "@/lib/shopify/admin";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import type { ShopifyOrderPayload } from "@/lib/b2b/types";

function shopifyNumericOrderId(gid?: string | null) {
  return gid?.replace("gid://shopify/Order/", "") ?? null;
}

async function hasSuccessfulDiloshopOrderForward(orderId: string) {
  const existing = await prisma.automationLog.findFirst({
    where: {
      shopifyOrderId: orderId,
      eventType: "diloshop/forward",
      step: "external_checkout_paid",
      status: "OK",
    },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(existing);
}

export async function retryDiloshopForwardForCheckoutSession(
  checkoutSessionId: string,
  input?: { force?: boolean }
) {
  const session = await prisma.checkoutSession.findUnique({
    where: { id: checkoutSessionId },
    include: {
      orderLink: true,
      paymentAttempts: true,
    },
  });

  if (!session?.orderLink?.shopifyOrderGid) {
    return { skipped: true as const, reason: "missing_shopify_order" as const, checkoutSessionId };
  }

  if (!session.paymentAttempts.some((attempt) => attempt.status === "PAID")) {
    return { skipped: true as const, reason: "not_paid_by_card" as const, checkoutSessionId };
  }

  const orderId = shopifyNumericOrderId(session.orderLink.shopifyOrderGid);
  if (!orderId) {
    return { skipped: true as const, reason: "invalid_shopify_order_gid" as const, checkoutSessionId };
  }

  if (!input?.force && await hasSuccessfulDiloshopOrderForward(orderId)) {
    return { skipped: true as const, reason: "already_forwarded" as const, checkoutSessionId, orderId };
  }

  const shopifySession = await getMerchantShopifySession(session.merchantId);
  if (!shopifySession) {
    await writeAutomationLog({
      shopifyOrderId: orderId,
      eventType: "diloshop/forward",
      step: "retry_config",
      status: "WARN",
      message: "Cannot retry Diloshop forward without Shopify session",
      metadata: { checkoutSessionId },
    });
    return { skipped: true as const, reason: "missing_shopify_session" as const, checkoutSessionId, orderId };
  }

  const response = await shopifyAdminREST(shopifySession, `orders/${orderId}.json`) as {
    order: ShopifyOrderPayload;
  };

  await forwardExternalCheckoutOrderToDiloshop({
    order: response.order,
    shopDomain: shopifySession.shop,
    checkoutSessionId,
    targets: { orders: true, novaPoshta: false },
  });

  return { ok: true as const, checkoutSessionId, orderId, shopifyOrderName: session.orderLink.shopifyOrderName };
}

export async function retryMissingDiloshopForRecentPaidOrders(input?: {
  take?: number;
  force?: boolean;
}) {
  const sessions = await prisma.checkoutSession.findMany({
    where: {
      paymentAttempts: { some: { status: "PAID" } },
      orderLink: { is: { shopifyOrderGid: { not: null } } },
    },
    orderBy: { updatedAt: "desc" },
    take: input?.take ?? 20,
    select: { id: true },
  });

  const results = [];
  for (const session of sessions) {
    try {
      results.push(await retryDiloshopForwardForCheckoutSession(session.id, { force: input?.force }));
    } catch (error) {
      await writeAutomationLog({
        eventType: "diloshop/forward",
        step: "retry_recent_paid_orders",
        status: "ERROR",
        message: "Diloshop retry for paid checkout failed",
        error,
        metadata: { checkoutSessionId: session.id },
      }).catch(() => {});
      results.push({
        checkoutSessionId: session.id,
        status: "ERROR",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: sessions.length, results };
}
