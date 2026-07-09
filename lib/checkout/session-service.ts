import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";
import { fetchVariantDilovodInvoiceNames } from "@/lib/shopify/variant-invoice-names";
import { applyCartUnitPriceHint, type CartLinePriceHint } from "@/lib/checkout/cart-pricing";
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
        image { url altText }
        product {
          id
          title
          handle
          featuredImage { url altText }
        }
        metafield(namespace: "kayer_dilovod", key: "invoice_name") {
          value
        }
      }
    }
  }
`;

const CHECKOUT_RECOMMENDATIONS_QUERY = `
  query CheckoutRecommendations {
    products(first: 8, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        featuredImage { url altText }
        variants(first: 1) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            image { url altText }
          }
        }
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
  image: { url: string; altText: string | null } | null;
  metafield: { value: string } | null;
  product: {
    id: string;
    title: string;
    handle: string;
    featuredImage: { url: string; altText: string | null } | null;
  };
};

type RecommendationProductNode = {
  id: string;
  title: string;
  handle: string;
  featuredImage: { url: string; altText: string | null } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      price: string;
      compareAtPrice: string | null;
      image: { url: string; altText: string | null } | null;
    }>;
  };
};

export async function resolveAndPriceLines(
  merchantId: string,
  cartLines: CartLinePriceHint[]
) {
  const session = await getMerchantShopifySession(merchantId);
  if (!session) throw new Error("Merchant Shopify session not found");

  const ids = cartLines.map((l) => l.variantGid);
  const [result, dilovodNames] = await Promise.all([
    shopifyAdminGraphQL<{
      data: { nodes: (VariantNode | null)[] };
    }>(session, VARIANT_QUERY, { ids }),
    fetchVariantDilovodInvoiceNames(session.shop, ids),
  ]);

  const nodes = result.data?.nodes ?? [];
  return cartLines.map((line, i) => {
    const variant = nodes[i];
    if (!variant) throw new Error(`Variant not found: ${line.variantGid}`);
    const catalogUnitPrice = Math.round(parseFloat(variant.price) * 100);
    const cartPricing = applyCartUnitPriceHint({
      catalogUnitPriceCents: catalogUnitPrice,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      originalUnitPriceCents: line.originalUnitPriceCents,
    });
    const compareAtPrice =
      cartPricing.compareAtPrice ??
      (variant.compareAtPrice ? Math.round(parseFloat(variant.compareAtPrice) * 100) : null);
    return {
      variantGid: variant.id,
      productGid: variant.product.id,
      sku: variant.sku,
      title: `${variant.product.title} — ${variant.title}`,
      quantity: line.quantity,
      unitPrice: cartPricing.unitPrice,
      compareAtPrice,
      lineDiscountAmount: cartPricing.lineDiscountAmount,
      metadata: {
        imageUrl: variant.image?.url ?? variant.product.featuredImage?.url ?? null,
        imageAlt: variant.image?.altText ?? variant.product.featuredImage?.altText ?? variant.product.title,
        productHandle: variant.product.handle,
        dilovodInvoiceName:
          dilovodNames.get(variant.id)?.trim() ||
          variant.metafield?.value?.trim() ||
          null,
        catalogUnitPriceCents: catalogUnitPrice,
        cartUnitPriceCents: line.unitPriceCents ?? null,
      },
    };
  });
}

async function getCheckoutRecommendations(merchantId: string, excludedProductGids: string[]) {
  const session = await getMerchantShopifySession(merchantId);
  if (!session) return [];

  try {
    const result = await shopifyAdminGraphQL<{
      data?: { products?: { nodes: RecommendationProductNode[] } };
    }>(session, CHECKOUT_RECOMMENDATIONS_QUERY);
    const excluded = new Set(excludedProductGids);
    return (result.data?.products?.nodes ?? [])
      .filter((product) => !excluded.has(product.id))
      .map((product) => {
        const variant = product.variants.nodes[0];
        if (!variant) return null;
        const image = variant.image ?? product.featuredImage;
        const unitPrice = Math.round(parseFloat(variant.price) * 100);
        const compareAtPrice = variant.compareAtPrice
          ? Math.round(parseFloat(variant.compareAtPrice) * 100)
          : null;
        return {
          productGid: product.id,
          variantGid: variant.id,
          title: product.title,
          variantTitle: variant.title,
          sku: variant.sku,
          handle: product.handle,
          imageUrl: image?.url ?? null,
          imageAlt: image?.altText ?? product.title,
          unitPrice,
          compareAtPrice,
        };
      })
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export type CreateCheckoutSessionInput = {
  merchantId: string;
  cartLines: CartLinePriceHint[];
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
  const recommendations = await getCheckoutRecommendations(
    input.merchantId,
    pricedLines.map((line) => line.productGid).filter(Boolean) as string[]
  );
  const totals = calcTotals(
    pricedLines.map((l) => ({
      ...l,
      id: "",
      checkoutSessionId: "",
      metadata: l.metadata ?? null,
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
        checkoutRecommendations: recommendations,
      },
      lines: {
        create: pricedLines.map((line) => ({
          variantGid: line.variantGid,
          productGid: line.productGid,
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          compareAtPrice: line.compareAtPrice,
          lineDiscountAmount: line.lineDiscountAmount,
          metadata: line.metadata,
        })),
      },
    },
    include: { lines: true, merchant: true },
  });

  return session;
}

export async function addCheckoutSessionLine(
  publicToken: string,
  input: { variantGid: string; quantity?: number }
) {
  const session = await prisma.checkoutSession.findUnique({
    where: { publicToken },
    include: { lines: true },
  });
  if (!session) throw new Error("Session not found");
  if (!["DRAFT", "READY"].includes(session.status)) {
    throw new Error("Checkout cannot be changed after payment started");
  }

  const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
  const [pricedLine] = await resolveAndPriceLines(session.merchantId, [
    { variantGid: input.variantGid, quantity },
  ]);
  const existing = session.lines.find((line) => line.variantGid === pricedLine.variantGid);

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.checkoutLine.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
      });
    } else {
      await tx.checkoutLine.create({
        data: {
          checkoutSessionId: session.id,
          variantGid: pricedLine.variantGid,
          productGid: pricedLine.productGid,
          sku: pricedLine.sku,
          title: pricedLine.title,
          quantity: pricedLine.quantity,
          unitPrice: pricedLine.unitPrice,
          compareAtPrice: pricedLine.compareAtPrice,
          lineDiscountAmount: pricedLine.lineDiscountAmount,
          metadata: pricedLine.metadata,
        },
      });
    }
  });

  return repriceCheckoutSession(publicToken);
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
    lines: session.lines.map((line) => {
      const metadata = (line.metadata ?? {}) as Record<string, unknown>;
      return {
        ...line,
        imageUrl: typeof metadata.imageUrl === "string" ? metadata.imageUrl : null,
        imageAlt: typeof metadata.imageAlt === "string" ? metadata.imageAlt : line.title,
        productHandle: typeof metadata.productHandle === "string" ? metadata.productHandle : null,
      };
    }),
    recommendations: Array.isArray(attrs.checkoutRecommendations)
      ? attrs.checkoutRecommendations
      : [],
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
