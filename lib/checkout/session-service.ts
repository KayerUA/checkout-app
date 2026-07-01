import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";
import { calcTotals } from "@/lib/checkout/pricing";
import { assertTransition } from "@/lib/checkout/state-machine";
import type { CheckoutStatus, PaymentProvider, Prisma } from "@prisma/client";

const VARIANT_QUERY = `
  query GetVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        sku
        price
        compareAtPrice
        product { id title }
      }
    }
  }
`;

type VariantNode = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  product: { id: string; title: string };
};

async function resolveAndPriceLines(
  merchantId: string,
  cartLines: Array<{ variantGid: string; quantity: number }>
) {
  const session = await getMerchantShopifySession(merchantId);
  if (!session) throw new Error("Merchant Shopify session not found");

  const ids = cartLines.map((l) => l.variantGid);
  const result = await shopifyAdminGraphQL<{
    data: { nodes: (VariantNode | null)[] };
  }>(session, VARIANT_QUERY, { ids });

  const nodes = result.data?.nodes ?? [];
  return cartLines.map((line, i) => {
    const variant = nodes[i];
    if (!variant) throw new Error(`Variant not found: ${line.variantGid}`);
    const unitPrice = Math.round(parseFloat(variant.price) * 100);
    const compareAtPrice = variant.compareAtPrice
      ? Math.round(parseFloat(variant.compareAtPrice) * 100)
      : null;
    return {
      variantGid: variant.id,
      productGid: variant.product.id,
      sku: variant.sku,
      title: `${variant.product.title} — ${variant.title}`,
      quantity: line.quantity,
      unitPrice,
      compareAtPrice,
    };
  });
}

export type CreateCheckoutSessionInput = {
  merchantId: string;
  cartLines: Array<{ variantGid: string; quantity: number }>;
  buyerIp?: string;
  utm?: Record<string, string>;
  sourceUrl?: string;
  customAttributes?: Record<string, unknown>;
  ab?: {
    experimentId: string;
    visitorId: string;
    variant: string;
    cartToken?: string;
  };
};

export async function createCheckoutSession(input: CreateCheckoutSessionInput) {
  const pricedLines = await resolveAndPriceLines(input.merchantId, input.cartLines);
  const totals = calcTotals(
    pricedLines.map((l) => ({
      ...l,
      id: "",
      checkoutSessionId: "",
      lineDiscountAmount: 0,
      metadata: null,
    }))
  );

  const session = await prisma.checkoutSession.create({
    data: {
      merchantId: input.merchantId,
      publicToken: crypto.randomUUID(),
      status: "DRAFT",
      sourceIdentifier: `chk_${crypto.randomUUID()}`,
      subtotal: totals.subtotal,
      totalAmount: totals.totalAmount,
      customAttributes: {
        ...(input.customAttributes ?? {}),
        utm: input.utm ?? {},
        buyerIp: input.buyerIp ?? null,
        sourceUrl: input.sourceUrl ?? null,
        ab: input.ab ?? null,
      },
      lines: { create: pricedLines },
    },
    include: { lines: true, merchant: true },
  });

  return session;
}

export async function getCheckoutSessionByToken(publicToken: string) {
  return prisma.checkoutSession.findUnique({
    where: { publicToken },
    include: {
      lines: true,
      merchant: true,
      paymentAttempts: { orderBy: { createdAt: "desc" } },
      orderLink: { include: { fiscalReceipt: true } },
    },
  });
}

export async function updateCheckoutSession(
  publicToken: string,
  data: {
    buyerEmail?: string;
    buyerPhone?: string;
    buyerFirstName?: string;
    buyerLastName?: string;
    shippingMethodCode?: string;
    shippingProvider?: string;
    shippingPayload?: Record<string, unknown>;
    paymentProvider?: PaymentProvider;
    customAttributes?: Record<string, unknown>;
    status?: CheckoutStatus;
  }
) {
  const existing = await prisma.checkoutSession.findUnique({
    where: { publicToken },
  });
  if (!existing) throw new Error("Session not found");

  if (data.status && data.status !== existing.status) {
    assertTransition(existing.status, data.status);
  }

  return prisma.checkoutSession.update({
    where: { publicToken },
    data: {
      ...data,
      customAttributes: data.customAttributes
        ? ({
            ...((existing.customAttributes ?? {}) as Record<string, unknown>),
            ...data.customAttributes,
          } as Prisma.InputJsonValue)
        : undefined,
      shippingPayload: data.shippingPayload as Prisma.InputJsonValue | undefined,
    },
    include: { lines: true, merchant: true },
  });
}

export async function repriceCheckoutSession(publicToken: string, shippingAmount?: number) {
  const session = await prisma.checkoutSession.findUnique({
    where: { publicToken },
    include: { lines: true },
  });
  if (!session) throw new Error("Session not found");

  const shipping = shippingAmount ?? session.shippingAmount;
  const totals = calcTotals(session.lines, shipping, session.discountAmount);

  return prisma.checkoutSession.update({
    where: { publicToken },
    data: {
      shippingAmount: totals.shippingAmount,
      subtotal: totals.subtotal,
      totalAmount: totals.totalAmount,
      status: session.status === "DRAFT" ? "READY" : session.status,
    },
    include: { lines: true, merchant: true },
  });
}

export async function markAbandonedSessions(staleMinutes = 60) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const result = await prisma.checkoutSession.updateMany({
    where: {
      status: { in: ["DRAFT", "READY", "PAYMENT_PENDING"] },
      updatedAt: { lt: cutoff },
      abandonedAt: null,
    },
    data: {
      status: "ABANDONED",
      abandonedAt: new Date(),
    },
  });
  return result.count;
}

export function serializePublicSession(
  session: Awaited<ReturnType<typeof getCheckoutSessionByToken>>
) {
  if (!session) return null;
  const theme = (session.merchant.themeConfig ?? {}) as Record<string, string>;
  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const ab = (attrs.ab ?? null) as Record<string, string> | null;
  return {
    publicToken: session.publicToken,
    status: session.status,
    currency: session.currency,
    subtotal: session.subtotal,
    shippingAmount: session.shippingAmount,
    discountAmount: session.discountAmount,
    totalAmount: session.totalAmount,
    buyerEmail: session.buyerEmail,
    buyerPhone: session.buyerPhone,
    buyerFirstName: session.buyerFirstName,
    buyerLastName: session.buyerLastName,
    shippingMethodCode: session.shippingMethodCode,
    shippingProvider: session.shippingProvider,
    shippingPayload: session.shippingPayload,
    paymentProvider: session.paymentProvider,
    customAttributes: session.customAttributes,
    lines: session.lines,
    theme,
    ab,
    orderLink: session.orderLink
      ? {
          shopifyOrderName: session.orderLink.shopifyOrderName,
          fiscalReceipt: session.orderLink.fiscalReceipt,
        }
      : null,
  };
}
