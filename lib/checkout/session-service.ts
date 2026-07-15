import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";
import { fetchVariantDilovodInvoiceNames } from "@/lib/shopify/variant-invoice-names";
import {
  applyCartUnitPriceHint,
  cartSubtotalMatchesHint,
  cartTotalMatchesExpected,
  computeCartLevelDiscountCents,
  type CartLinePriceHint,
  type ResolvedCartLinePricing,
} from "@/lib/checkout/cart-pricing";
import {
  fetchPartnerPricingContextByGid,
  normalizeCheckoutEmail,
  partnerUnitPriceFromCatalog,
  type PartnerPricingContext,
} from "@/lib/checkout/partner-pricing";
import { verifyStorefrontPricingToken } from "@/lib/checkout/storefront-pricing-token";
import { buildCheckoutLineTitle } from "@/lib/checkout/line-display";
import { buildSavingsSummary } from "@/lib/checkout/savings-summary";
import {
  CheckoutDiscountError,
  assertCheckoutPromoAllowed,
  computeCheckoutDiscountCents,
  fetchCheckoutDiscountByCode,
  normalizeDiscountCode,
  promoDiscountRowTitle,
} from "@/lib/checkout/discount-code";
import { calcTotals } from "@/lib/checkout/pricing";
import { assertTransition } from "@/lib/checkout/state-machine";
import type { CheckoutStatus, PaymentProvider, Prisma } from "@prisma/client";
import type { CheckoutSessionPatch } from "@/lib/checkout/public-input";

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
          collections(first: 50) {
            nodes { handle }
          }
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
    collections: { nodes: Array<{ handle: string }> };
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
  cartLines: CartLinePriceHint[],
  options?: {
    partnerContext?: PartnerPricingContext | null;
    useRetailCartHints?: boolean;
    forceCartSnapshot?: boolean;
  }
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
    const collectionHandles = (variant.product.collections?.nodes ?? []).map((node) => node.handle);
    const partnerContext = options?.partnerContext;
    let unitPrice = catalogUnitPrice;
    let pricingSource: "catalog" | "partner_rules" | "shopify_cart" = "catalog";

    if (
      options?.forceCartSnapshot &&
      typeof line.unitPriceCents === "number" &&
      line.unitPriceCents > 0
    ) {
      unitPrice = Math.round(line.unitPriceCents);
      pricingSource = partnerContext ? "partner_rules" : "shopify_cart";
    } else if (partnerContext) {
      unitPrice = partnerUnitPriceFromCatalog(
        catalogUnitPrice,
        partnerContext.rules,
        collectionHandles
      );
      pricingSource = "partner_rules";
    } else if (options?.useRetailCartHints !== false) {
      const cartPricing = applyCartUnitPriceHint({
        catalogUnitPriceCents: catalogUnitPrice,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        originalUnitPriceCents: line.originalUnitPriceCents,
      });
      unitPrice = cartPricing.unitPrice;
      if (cartPricing.usedCartHint) pricingSource = "shopify_cart";
    }

    const compareAtPrice =
      unitPrice < catalogUnitPrice
        ? catalogUnitPrice
        : variant.compareAtPrice
          ? Math.round(parseFloat(variant.compareAtPrice) * 100)
          : catalogUnitPrice || null;
    return {
      variantGid: variant.id,
      productGid: variant.product.id,
      sku: variant.sku,
      title: buildCheckoutLineTitle({
        productTitle: variant.product.title,
        variantTitle: variant.title,
      }),
      quantity: line.quantity,
      unitPrice,
      compareAtPrice: compareAtPrice && compareAtPrice > unitPrice ? compareAtPrice : catalogUnitPrice || null,
      lineDiscountAmount: 0,
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
        pricingSource,
        partnerCustomerGid: partnerContext?.customerGid ?? null,
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
  storefrontCustomerEmail?: string;
  storefrontCustomerId?: string;
  storefrontCustomerFirstName?: string;
  storefrontCustomerLastName?: string;
  storefrontCustomerPhone?: string;
  storefrontPricingToken?: string;
  cartToken?: string;
  cartItemsSubtotalCents?: number;
  cartTotalCents?: number;
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

async function resolvePartnerContextForMerchant(input: {
  merchantId: string;
  shopDomain?: string;
  storefrontPricingToken?: string;
  verifiedPartnerGid?: string | null;
}): Promise<PartnerPricingContext | null> {
  const shopifySession = await getMerchantShopifySession(input.merchantId);
  if (!shopifySession) return null;

  if (input.storefrontPricingToken) {
    const payload = verifyStorefrontPricingToken(
      input.storefrontPricingToken,
      input.shopDomain ?? shopifySession.shop
    );
    if (payload) {
      return fetchPartnerPricingContextByGid(shopifySession, payload.customerGid);
    }
  }

  const verifiedGid = input.verifiedPartnerGid?.trim();
  if (verifiedGid) {
    return fetchPartnerPricingContextByGid(shopifySession, verifiedGid);
  }

  return null;
}

async function resolvePartnerContextForSession(input: {
  merchantId: string;
  verifiedPartnerGid?: string | null;
}): Promise<PartnerPricingContext | null> {
  return resolvePartnerContextForMerchant({
    merchantId: input.merchantId,
    verifiedPartnerGid: input.verifiedPartnerGid,
  });
}

function verifiedIdentityFromPricingToken(input: {
  storefrontPricingToken?: string;
  shopDomain?: string;
}): { email: string | null; customerGid: string | null } {
  if (!input.storefrontPricingToken) {
    return { email: null, customerGid: null };
  }
  const payload = verifyStorefrontPricingToken(input.storefrontPricingToken, input.shopDomain);
  if (!payload) return { email: null, customerGid: null };
  return {
    email: normalizeCheckoutEmail(payload.email) || null,
    customerGid: payload.customerGid,
  };
}

export async function ensureSessionLinePricing(publicToken: string) {
  const session = await prisma.checkoutSession.findUnique({
    where: { publicToken },
    include: { lines: true },
  });
  if (!session) throw new Error("Session not found");
  if (!session.lines.length) return;

  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const verifiedPartnerGid =
    typeof attrs.partnerCustomerGid === "string" ? attrs.partnerCustomerGid : null;

  const partnerContext = await resolvePartnerContextForSession({
    merchantId: session.merchantId,
    verifiedPartnerGid,
  });

  const repricedLines = await resolveAndPriceLines(
    session.merchantId,
    session.lines.map((line) => {
      const metadata = (line.metadata ?? {}) as Record<string, unknown>;
      return {
        variantGid: line.variantGid,
        quantity: line.quantity,
        unitPriceCents:
          typeof metadata.cartUnitPriceCents === "number" ? metadata.cartUnitPriceCents : undefined,
        originalUnitPriceCents:
          typeof metadata.catalogUnitPriceCents === "number"
            ? metadata.catalogUnitPriceCents
            : undefined,
      };
    }),
    { partnerContext, useRetailCartHints: !partnerContext }
  );

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < session.lines.length; i += 1) {
      const existing = session.lines[i];
      const repriced = repricedLines[i];
      if (!repriced) continue;
      await tx.checkoutLine.update({
        where: { id: existing.id },
        data: {
          unitPrice: repriced.unitPrice,
          compareAtPrice: repriced.compareAtPrice,
          lineDiscountAmount: 0,
          metadata: repriced.metadata as Prisma.InputJsonValue,
        },
      });
    }
  });
}

async function recalcCheckoutSessionTotals(publicToken: string, shippingAmount?: number) {
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

function linesSubtotalCents(
  lines: Array<Pick<ResolvedCartLinePricing, "unitPrice" | "lineDiscountAmount"> & { quantity: number }>
) {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity - line.lineDiscountAmount, 0);
}

export async function createCheckoutSession(input: CreateCheckoutSessionInput) {
  const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
  const shopDomain = merchant?.shopDomain;

  const tokenIdentity = verifiedIdentityFromPricingToken({
    storefrontPricingToken: input.storefrontPricingToken,
    shopDomain,
  });

  const partnerContext = await resolvePartnerContextForMerchant({
    merchantId: input.merchantId,
    shopDomain,
    storefrontPricingToken: input.storefrontPricingToken,
  });

  let pricedLines = await resolveAndPriceLines(input.merchantId, input.cartLines, {
    partnerContext,
    useRetailCartHints: !partnerContext,
  });

  if (partnerContext && input.cartItemsSubtotalCents != null) {
    const partnerSubtotal = linesSubtotalCents(pricedLines);
    const tolerance = Math.max(100, Math.round(input.cartItemsSubtotalCents * 0.02));
    if (Math.abs(partnerSubtotal - Math.round(input.cartItemsSubtotalCents)) > tolerance) {
      pricedLines = await resolveAndPriceLines(input.merchantId, input.cartLines, {
        partnerContext,
        forceCartSnapshot: true,
      });
    }
  }

  if (!partnerContext && input.cartItemsSubtotalCents != null) {
    if (!cartSubtotalMatchesHint(pricedLines, input.cartItemsSubtotalCents)) {
      pricedLines = await resolveAndPriceLines(input.merchantId, input.cartLines, {
        partnerContext: null,
        useRetailCartHints: false,
      });
    }
  }

  let linesSubtotal = linesSubtotalCents(pricedLines);
  const inputAttributes = { ...(input.customAttributes ?? {}) };
  const requestedDiscountCode =
    typeof inputAttributes.appliedDiscountCode === "string"
      ? normalizeDiscountCode(inputAttributes.appliedDiscountCode)
      : "";
  delete inputAttributes.appliedDiscountCode;

  let validatedDiscountCode = "";
  let validatedPromoTitle = "";
  let discountAmount = partnerContext || requestedDiscountCode
    ? 0
    : computeCartLevelDiscountCents(linesSubtotal, input.cartTotalCents);

  if (
    !partnerContext &&
    !cartTotalMatchesExpected(linesSubtotal, discountAmount, input.cartTotalCents)
  ) {
    const snapshotLines = await resolveAndPriceLines(input.merchantId, input.cartLines, {
      partnerContext: null,
      forceCartSnapshot: true,
    });
    const snapshotSubtotal = linesSubtotalCents(snapshotLines);
    const snapshotDiscount = computeCartLevelDiscountCents(snapshotSubtotal, input.cartTotalCents);
    if (cartTotalMatchesExpected(snapshotSubtotal, snapshotDiscount, input.cartTotalCents)) {
      pricedLines = snapshotLines;
      linesSubtotal = snapshotSubtotal;
      discountAmount = snapshotDiscount;
    } else if (
      typeof input.cartTotalCents === "number" &&
      input.cartLines.every(
        (line) => typeof line.unitPriceCents === "number" && line.unitPriceCents > 0
      )
    ) {
      pricedLines = snapshotLines;
      linesSubtotal = snapshotSubtotal;
      discountAmount = computeCartLevelDiscountCents(linesSubtotal, input.cartTotalCents);
    } else {
      throw new Error("Cart total mismatch — refresh cart and try again");
    }
  }

  if (requestedDiscountCode) {
    assertCheckoutPromoAllowed(partnerContext ? "partner_rules" : "shopify_cart");
    const discount = await fetchCheckoutDiscountByCode(input.merchantId, requestedDiscountCode);
    discountAmount = computeCheckoutDiscountCents({
      subtotalCents: linesSubtotal,
      discount,
    });
    if (discountAmount <= 0) {
      throw new CheckoutDiscountError("Промокод не дає знижки для поточного замовлення");
    }
    validatedDiscountCode = requestedDiscountCode;
    validatedPromoTitle = promoDiscountRowTitle(requestedDiscountCode, discount.title);
  }

  const verifiedPartnerEmail =
    partnerContext?.email ??
    tokenIdentity.email ??
    (normalizeCheckoutEmail(input.storefrontCustomerEmail) || null);
  const verifiedPartnerGid =
    partnerContext?.customerGid ?? tokenIdentity.customerGid ?? null;
  const storefrontCustomerFirstName = input.storefrontCustomerFirstName?.trim() || null;
  const storefrontCustomerLastName = input.storefrontCustomerLastName?.trim() || null;
  const storefrontCustomerPhone = input.storefrontCustomerPhone?.trim() || null;

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
    })),
    0,
    discountAmount
  );
  const cartDiscountSnapshot = validatedDiscountCode
    ? buildPromoCartDiscountSnapshot(
        {
          lines: pricedLines,
          subtotal: totals.subtotal,
          shippingAmount: totals.shippingAmount,
          customAttributes: inputAttributes,
        },
        {
          discountCents: totals.discountAmount,
          promoTitle: validatedPromoTitle,
          pricingMode: "shopify_cart",
        }
      )
    : inputAttributes.cartDiscountSnapshot ?? null;

  const cartToken = input.cartToken ?? input.ab?.cartToken;
  const sourceIdentifier = cartToken
    ? `chk_cart_${crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            merchantId: input.merchantId,
            cartToken,
            cartLines: input.cartLines.map((line) => ({
              variantGid: line.variantGid,
              quantity: line.quantity,
            })),
            cartTotalCents: input.cartTotalCents ?? null,
            appliedDiscountCode: validatedDiscountCode || null,
          })
        )
        .digest("hex")
        .slice(0, 32)}`
    : `chk_${crypto.randomUUID()}`;

  const data: Prisma.CheckoutSessionUncheckedCreateInput = {
      merchantId: input.merchantId,
      publicToken: crypto.randomUUID(),
      status: "DRAFT",
      sourceIdentifier,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      totalAmount: totals.totalAmount,
      buyerEmail: verifiedPartnerEmail,
      buyerPhone: storefrontCustomerPhone,
      buyerFirstName: storefrontCustomerFirstName,
      buyerLastName: storefrontCustomerLastName,
      customAttributes: {
        ...inputAttributes,
        utm: input.utm ?? {},
        buyerIp: input.buyerIp ?? null,
        sourceUrl: input.sourceUrl ?? null,
        ab: input.ab ?? null,
        cartToken: input.cartToken ?? input.ab?.cartToken ?? null,
        checkoutRecommendations: recommendations,
        verifiedPartnerEmail,
        partnerCustomerGid: verifiedPartnerGid,
        pricingMode: partnerContext ? "partner_rules" : "shopify_cart",
        cartDiscountSnapshot,
        ...(validatedDiscountCode ? { appliedDiscountCode: validatedDiscountCode } : {}),
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
    };

  try {
    return await prisma.checkoutSession.create({
      data,
      include: { lines: true, merchant: true },
    });
  } catch (error) {
    const isUniqueConflict =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002";
    if (!isUniqueConflict) throw error;

    const existing = await prisma.checkoutSession.findUnique({
      where: { sourceIdentifier },
      include: { lines: true, merchant: true },
    });
    if (!existing) throw error;
    return existing;
  }
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
  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const partnerContext = await resolvePartnerContextForSession({
    merchantId: session.merchantId,
    verifiedPartnerGid:
      typeof attrs.partnerCustomerGid === "string" ? attrs.partnerCustomerGid : null,
  });
  const [pricedLine] = await resolveAndPriceLines(
    session.merchantId,
    [{ variantGid: input.variantGid, quantity }],
    { partnerContext, useRetailCartHints: !partnerContext }
  );
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
  data: CheckoutSessionPatch
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
      buyerEmail: data.buyerEmail,
      buyerPhone: data.buyerPhone,
      buyerFirstName: data.buyerFirstName,
      buyerLastName: data.buyerLastName,
      shippingMethodCode: data.shippingMethodCode,
      shippingProvider: data.shippingProvider,
      paymentProvider: data.paymentProvider as PaymentProvider | undefined,
      status: data.status as CheckoutStatus | undefined,
      customAttributes: data.customAttributes
        ? ({
            ...((existing.customAttributes ?? {}) as Record<string, unknown>),
            ...data.customAttributes,
          } as Prisma.InputJsonValue)
        : undefined,
      shippingPayload: data.shippingPayload as Prisma.InputJsonValue | undefined,
    },
    include: { lines: true, merchant: true },
  }).then(async (session) => {
    if (data.buyerEmail) {
      await ensureSessionLinePricing(session.publicToken);
    }
    return prisma.checkoutSession.findUniqueOrThrow({
      where: { publicToken },
      include: { lines: true, merchant: true },
    });
  });
}

export async function repriceCheckoutSession(publicToken: string, shippingAmount?: number) {
  await ensureSessionLinePricing(publicToken);
  const session = await getCheckoutSessionByToken(publicToken);
  const attrs = (session?.customAttributes ?? {}) as Record<string, unknown>;
  if (typeof attrs.appliedDiscountCode === "string" && attrs.appliedDiscountCode.trim()) {
    await applyCheckoutDiscountCode(publicToken, attrs.appliedDiscountCode);
  }
  return recalcCheckoutSessionTotals(publicToken, shippingAmount);
}

function lineCatalogCentsForSnapshot(line: {
  unitPrice: number;
  compareAtPrice?: number | null;
  metadata?: unknown;
}) {
  const metadata = (line.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.catalogUnitPriceCents === "number" && metadata.catalogUnitPriceCents > 0) {
    return Math.round(metadata.catalogUnitPriceCents);
  }
  if (typeof line.compareAtPrice === "number" && line.compareAtPrice > line.unitPrice) {
    return Math.round(line.compareAtPrice);
  }
  return Math.round(line.unitPrice);
}

function buildPromoCartDiscountSnapshot(
  session: {
    lines: Array<{
      unitPrice: number;
      quantity: number;
      compareAtPrice?: number | null;
      metadata?: unknown;
    }>;
    subtotal: number;
    shippingAmount: number;
    customAttributes?: unknown;
  } | null,
  input: {
    discountCents: number;
    promoTitle: string;
    pricingMode: string;
  }
) {
  if (!session) throw new Error("Session not found");

  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const existingSnapshot = (attrs.cartDiscountSnapshot ?? null) as {
    grossSubtotalCents?: number;
    discountRows?: Array<{ title?: string; amountCents?: number }>;
  } | null;

  const grossFromLines = session.lines.reduce(
    (sum, line) => sum + lineCatalogCentsForSnapshot(line) * line.quantity,
    0
  );
  const grossSubtotalCents =
    typeof existingSnapshot?.grossSubtotalCents === "number" && existingSnapshot.grossSubtotalCents > 0
      ? Math.round(existingSnapshot.grossSubtotalCents)
      : grossFromLines;

  const lineDiscountCents = Math.max(0, grossSubtotalCents - session.subtotal);
  const promoPrefix = "Промокод";
  const discountRows: Array<{ title: string; amountCents: number }> = [];

  for (const row of existingSnapshot?.discountRows ?? []) {
    const title = String(row?.title ?? "").trim();
    const amountCents = Math.max(0, Math.round(row?.amountCents ?? 0));
    if (!title || amountCents <= 0 || title.startsWith(promoPrefix)) continue;
    discountRows.push({ title, amountCents });
  }

  if (lineDiscountCents > 0 && !discountRows.some((row) => row.title === "Знижки на товари")) {
    discountRows.unshift({
      title: input.pricingMode === "partner_rules" ? "Партнерська знижка" : "Знижки на товари",
      amountCents: lineDiscountCents,
    });
  }

  if (input.discountCents > 0) {
    discountRows.push({ title: input.promoTitle, amountCents: input.discountCents });
  }

  const totalDueCents = Math.max(
    0,
    session.subtotal + session.shippingAmount - input.discountCents
  );

  return {
    grossSubtotalCents,
    discountRows,
    totalDueCents,
    pricingMode: "shopify_cart" as const,
  };
}

export async function applyCheckoutDiscountCode(publicToken: string, rawCode: string) {
  const session = await getCheckoutSessionByToken(publicToken);
  if (!session) throw new Error("Session not found");
  if (!["DRAFT", "READY"].includes(session.status)) {
    throw new Error("Checkout cannot be changed after payment started");
  }

  const attrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const pricingMode = typeof attrs.pricingMode === "string" ? attrs.pricingMode : "shopify_cart";
  assertCheckoutPromoAllowed(pricingMode);

  const code = normalizeDiscountCode(rawCode);
  if (!code) {
    throw new CheckoutDiscountError("Введіть промокод");
  }

  const discount = await fetchCheckoutDiscountByCode(session.merchantId, code);
  const subtotalCents = linesSubtotalCents(session.lines);
  const discountCents = computeCheckoutDiscountCents({ subtotalCents, discount });
  if (discountCents <= 0) {
    throw new CheckoutDiscountError("Промокод не дає знижки для поточного замовлення");
  }

  const promoTitle = promoDiscountRowTitle(code, discount.title);
  const cartDiscountSnapshot = buildPromoCartDiscountSnapshot(session, {
    discountCents,
    promoTitle,
    pricingMode,
  });
  const totals = calcTotals(session.lines, session.shippingAmount, discountCents);

  return prisma.checkoutSession.update({
    where: { publicToken },
    data: {
      subtotal: totals.subtotal,
      discountAmount: discountCents,
      totalAmount: totals.totalAmount,
      status: session.status === "DRAFT" ? "READY" : session.status,
      customAttributes: {
        ...attrs,
        appliedDiscountCode: code,
        cartDiscountSnapshot,
      } as Prisma.InputJsonValue,
    },
    include: {
      lines: true,
      merchant: true,
      paymentAttempts: { orderBy: { createdAt: "desc" } },
      orderLink: { include: { fiscalReceipt: true } },
    },
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
  const savingsSummary = buildSavingsSummary(session, attrs);
  const editableAttributes = Object.fromEntries(
    [
      "buyer_type",
      "payment_preference",
      "fop_name",
      "fop_tax_id",
      "fop_legal_address",
      "docs_email",
      "docs_phone",
      "accounting_comment",
    ]
      .filter((key) => key in attrs)
      .map((key) => [key, attrs[key]])
  );
  return {
    publicToken: session.publicToken,
    status: session.status,
    currency: session.currency,
    subtotal: session.subtotal,
    shippingAmount: session.shippingAmount,
    discountAmount: session.discountAmount,
    totalAmount: session.totalAmount,
    savingsSummary,
    appliedDiscountCode:
      typeof attrs.appliedDiscountCode === "string" ? attrs.appliedDiscountCode : null,
    pricingMode: typeof attrs.pricingMode === "string" ? attrs.pricingMode : "shopify_cart",
    buyerEmail: session.buyerEmail,
    buyerPhone: session.buyerPhone,
    buyerFirstName: session.buyerFirstName,
    buyerLastName: session.buyerLastName,
    shippingMethodCode: session.shippingMethodCode,
    shippingProvider: session.shippingProvider,
    shippingPayload: session.shippingPayload,
    paymentProvider: session.paymentProvider,
    customAttributes: editableAttributes,
    lines: session.lines.map((line) => {
      const metadata = (line.metadata ?? {}) as Record<string, unknown>;
      return {
        id: line.id,
        title: line.title,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        compareAtPrice: line.compareAtPrice,
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
