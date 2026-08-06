import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getMerchantShopifySession } from "@/lib/shopify/session-store";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin";
import { fetchVariantDilovodInvoiceNames } from "@/lib/shopify/variant-invoice-names";
import {
  applyCartUnitPriceHint,
  cartOriginalsMatchCatalog,
  cartSubtotalMatchesHint,
  cartTotalMatchesExpected,
  computeCartLevelDiscountCents,
  type CartLinePriceHint,
  type ResolvedCartLinePricing,
} from "@/lib/checkout/cart-pricing";
import {
  fetchPartnerPricingContextByGid,
  isPartnerProgramDiscountCode,
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
  eligibleSubtotalCents,
  fetchCheckoutDiscountByCode,
  normalizeDiscountCode,
  promoDiscountRowTitle,
} from "@/lib/checkout/discount-code";
import { computeLoyaltyDiscount, fetchOrderLoyaltyLadder } from "@/lib/checkout/loyalty-ladder";
import { calcTotals } from "@/lib/checkout/pricing";
import { assertTransition } from "@/lib/checkout/state-machine";
import { normalizeUaPersonName } from "@/lib/checkout/ua-person-name";
import { normalizeUaPhone } from "@/lib/checkout/phone";
import {
  assertCheckoutReadyForFulfillment,
  CheckoutFulfillmentValidationError,
} from "@/lib/checkout/fulfillment-validation";
import {
  canUseNovaPoshtaPostomat,
  novaPoshtaPostomatLimitMessage,
} from "@/lib/shipping/nova-poshta-postomat-policy";
import { resolveNovaPoshtaBranchType } from "@/lib/shipping/nova-poshta";
import { Prisma, type CheckoutStatus, type PaymentProvider } from "@prisma/client";
import type { CheckoutSessionPatch } from "@/lib/checkout/public-input";
import {
  legalEntitySnapshotSchema,
  legalEntityV2Enabled,
  legacyAttributesFromSnapshot,
  snapshotFromLegacyAttributes,
} from "@/lib/legal-entities/model";
import {
  LegalEntityAccessError,
  resolveOwnedLegalEntitySnapshot,
} from "@/lib/legal-entities/service";

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

    if (partnerContext) {
      // Source of truth: Admin retail × partner rules. Ignore cart.js (retail or already-buy).
      unitPrice = partnerUnitPriceFromCatalog(
        catalogUnitPrice,
        partnerContext.rules,
        collectionHandles,
        partnerContext.market
      );
      pricingSource = "partner_rules";
    } else if (
      options?.forceCartSnapshot &&
      typeof line.unitPriceCents === "number" &&
      line.unitPriceCents > 0
    ) {
      unitPrice = Math.round(line.unitPriceCents);
      pricingSource = "shopify_cart";
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
        collectionHandles,
        catalogUnitPriceCents: catalogUnitPrice,
        cartUnitPriceCents: line.unitPriceCents ?? null,
        partnerUnitPriceCents: partnerContext ? unitPrice : null,
        pricingSource,
        partnerCustomerGid: partnerContext?.customerGid ?? null,
        partnerMarket: partnerContext?.market ?? null,
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
};

function storefrontCustomerGid(rawId?: string | null): string | null {
  const trimmed = rawId?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("gid://") ? trimmed : `gid://shopify/Customer/${trimmed}`;
}

export async function resolveVerifiedPartnerContextForMerchant(input: {
  merchantId: string;
  shopDomain?: string;
  storefrontPricingToken?: string;
  verifiedPartnerGid?: string | null;
  storefrontCustomerEmail?: string;
  storefrontCustomerId?: string;
}): Promise<PartnerPricingContext | null> {
  const shopifySession = await getMerchantShopifySession(input.merchantId);
  if (!shopifySession) return null;

  if (input.storefrontPricingToken) {
    const payload = verifyStorefrontPricingToken(
      input.storefrontPricingToken,
      input.shopDomain ?? shopifySession.shop
    );
    if (payload) {
      const fromToken = await fetchPartnerPricingContextByGid(shopifySession, payload.customerGid);
      if (fromToken) return fromToken;
    }
  }

  const verifiedGid = input.verifiedPartnerGid?.trim();
  if (verifiedGid) {
    const fromVerifiedGid = await fetchPartnerPricingContextByGid(shopifySession, verifiedGid);
    if (fromVerifiedGid) return fromVerifiedGid;
  }

  const storefrontEmail = normalizeCheckoutEmail(input.storefrontCustomerEmail);
  const storefrontGid = storefrontCustomerGid(input.storefrontCustomerId);
  if (storefrontEmail && storefrontGid) {
    const fromStorefrontIdentity = await fetchPartnerPricingContextByGid(
      shopifySession,
      storefrontGid
    );
    if (
      fromStorefrontIdentity &&
      normalizeCheckoutEmail(fromStorefrontIdentity.email) === storefrontEmail
    ) {
      return fromStorefrontIdentity;
    }
  }

  return null;
}

async function resolvePartnerContextForSession(input: {
  merchantId: string;
  verifiedPartnerGid?: string | null;
}): Promise<PartnerPricingContext | null> {
  return resolveVerifiedPartnerContextForMerchant({
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

  // Avoid interactive $transaction: large carts (50–80+ lines) plus Supabase
  // pooler routinely close the tx before sequential updates finish, which
  // surfaces to the buyer as a generic "Не вдалося зберегти дані" on PATCH.
  const updates = session.lines.flatMap((existing, i) => {
    const repriced = repricedLines[i];
    if (!repriced) return [];
    return [
      prisma.checkoutLine.update({
        where: { id: existing.id },
        data: {
          unitPrice: repriced.unitPrice,
          compareAtPrice: repriced.compareAtPrice,
          lineDiscountAmount: 0,
          metadata: repriced.metadata as Prisma.InputJsonValue,
        },
      }),
    ];
  });

  const chunkSize = 25;
  for (let start = 0; start < updates.length; start += chunkSize) {
    await Promise.all(updates.slice(start, start + chunkSize));
  }
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

  const partnerContext = await resolveVerifiedPartnerContextForMerchant({
    merchantId: input.merchantId,
    shopDomain,
    storefrontPricingToken: input.storefrontPricingToken,
    storefrontCustomerEmail: input.storefrontCustomerEmail,
    storefrontCustomerId: input.storefrontCustomerId,
  });

  let pricedLines = await resolveAndPriceLines(input.merchantId, input.cartLines, {
    partnerContext,
    useRetailCartHints: !partnerContext,
  });

  const cartCatalogFresh = cartOriginalsMatchCatalog(
    pricedLines.map((line, index) => ({
      catalogUnitPriceCents:
        typeof line.metadata?.catalogUnitPriceCents === "number"
          ? line.metadata.catalogUnitPriceCents
          : line.unitPrice,
      originalUnitPriceCents: input.cartLines[index]?.originalUnitPriceCents,
    }))
  );

  if (partnerContext && input.cartItemsSubtotalCents != null) {
    const partnerSubtotal = linesSubtotalCents(pricedLines);
    const tolerance = Math.max(100, Math.round(input.cartItemsSubtotalCents * 0.02));
    if (Math.abs(partnerSubtotal - Math.round(input.cartItemsSubtotalCents)) > tolerance) {
      // Only trust cart units when originals still match live Admin catalog.
      // After a reprice, keep Admin × partner rules (do not bake stale cart).
      if (cartCatalogFresh) {
        pricedLines = await resolveAndPriceLines(input.merchantId, input.cartLines, {
          partnerContext,
          forceCartSnapshot: true,
        });
      }
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
  let requestedDiscountCode =
    typeof inputAttributes.appliedDiscountCode === "string"
      ? normalizeDiscountCode(inputAttributes.appliedDiscountCode)
      : "";
  delete inputAttributes.appliedDiscountCode;

  // Partner % is baked into unit prices — never stack retail promos (KAYERUA5,
  // newsletter cookie, PARTNER-*, etc.). Strip silently; do not hard-block checkout.
  if (partnerContext && requestedDiscountCode) {
    requestedDiscountCode = "";
    if (
      typeof input.cartItemsSubtotalCents === "number" &&
      typeof input.cartTotalCents === "number" &&
      input.cartTotalCents < input.cartItemsSubtotalCents
    ) {
      input.cartTotalCents = input.cartItemsSubtotalCents;
    }
  }

  // PARTNER-* is never a B2C promo. If identity is not verified (App Proxy down,
  // guest cart with a leftover code), strip it and continue on catalog / cart hints
  // instead of hard-blocking checkout.
  if (!partnerContext && isPartnerProgramDiscountCode(requestedDiscountCode)) {
    requestedDiscountCode = "";
  }

  let validatedDiscountCode = "";
  let validatedPromoTitle = "";
  // Cart-level discount = ORDER-class automatic discount (BRUTTO loyalty ladder) that the
  // storefront cart already applied. It must survive a promo code, not be replaced by it.
  let cartAutoDiscount = partnerContext
    ? 0
    : computeCartLevelDiscountCents(linesSubtotal, input.cartTotalCents);
  let loyaltyDiscount = 0;
  let loyaltyTitle = "";
  let discountAmount = cartAutoDiscount;

  if (
    !partnerContext &&
    !cartTotalMatchesExpected(linesSubtotal, cartAutoDiscount, input.cartTotalCents)
  ) {
    // forceCartSnapshot is only safe when cart originals = live Admin catalog
    // (Shopify automatic discounts baked into final_price). After catalog reprice,
    // stale cart units (e.g. old×0.85 Loyalty) must not become order unit prices.
    if (!cartCatalogFresh) {
      throw new Error("Cart total mismatch — refresh cart and try again");
    }

    const snapshotLines = await resolveAndPriceLines(input.merchantId, input.cartLines, {
      partnerContext: null,
      forceCartSnapshot: true,
    });
    const snapshotSubtotal = linesSubtotalCents(snapshotLines);
    const snapshotDiscount = computeCartLevelDiscountCents(snapshotSubtotal, input.cartTotalCents);
    if (cartTotalMatchesExpected(snapshotSubtotal, snapshotDiscount, input.cartTotalCents)) {
      pricedLines = snapshotLines;
      linesSubtotal = snapshotSubtotal;
      cartAutoDiscount = snapshotDiscount;
      discountAmount = snapshotDiscount;
    } else {
      throw new Error("Cart total mismatch — refresh cart and try again");
    }
  }

  if (cartAutoDiscount > 0) {
    loyaltyDiscount = cartAutoDiscount;
  }

  if (requestedDiscountCode) {
    assertCheckoutPromoAllowed(partnerContext ? "partner_rules" : "shopify_cart");
    const discount = await fetchCheckoutDiscountByCode(input.merchantId, requestedDiscountCode);
    const promoDiscount = computeCheckoutDiscountCents({
      subtotalCents: linesSubtotal,
      discount,
      eligibleSubtotalCents: eligibleSubtotalCents(pricedLines, discount),
    });
    if (promoDiscount <= 0) {
      throw new CheckoutDiscountError("Промокод не дає знижки для поточного замовлення");
    }
    // The code is PRODUCT-class and stacks with the loyalty ladder, but Shopify re-picks
    // the ORDER-class tier on what is left after it — a code can drop 15% down to 10%.
    const reevaluated =
      cartAutoDiscount > 0
        ? computeLoyaltyDiscount(
            await fetchOrderLoyaltyLadder(input.merchantId),
            Math.max(0, linesSubtotal - promoDiscount)
          )
        : { tier: null, discountCents: 0 };
    loyaltyDiscount = reevaluated.discountCents;
    loyaltyTitle = reevaluated.tier?.title ?? "";
    discountAmount = promoDiscount + loyaltyDiscount;
    validatedDiscountCode = requestedDiscountCode;
    validatedPromoTitle = promoDiscountRowTitle(requestedDiscountCode, discount.title);
  }

  const verifiedPartnerEmail =
    partnerContext?.email ??
    tokenIdentity.email ??
    null;
  const verifiedPartnerGid =
    partnerContext?.customerGid ?? tokenIdentity.customerGid ?? null;
  const buyerEmail =
    verifiedPartnerEmail ??
    (normalizeCheckoutEmail(input.storefrontCustomerEmail) || null);
  const storefrontCustomerFirstName =
    normalizeUaPersonName(input.storefrontCustomerFirstName?.trim() || null) ?? null;
  const storefrontCustomerLastName =
    normalizeUaPersonName(input.storefrontCustomerLastName?.trim() || null) ?? null;
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
          loyaltyCents: loyaltyDiscount,
          loyaltyTitle,
        }
      )
    : inputAttributes.cartDiscountSnapshot ?? null;

  const cartToken = input.cartToken;
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
      buyerEmail,
      buyerPhone: normalizeUaPhone(storefrontCustomerPhone) ?? null,
      buyerFirstName: storefrontCustomerFirstName,
      buyerLastName: storefrontCustomerLastName,
      shopifyCustomerGid: verifiedPartnerGid,
      customAttributes: {
        ...inputAttributes,
        utm: input.utm ?? {},
        buyerIp: input.buyerIp ?? null,
        sourceUrl: input.sourceUrl ?? null,
        cartToken: input.cartToken ?? null,
        checkoutRecommendations: recommendations,
        verifiedPartnerEmail,
        partnerCustomerGid: verifiedPartnerGid,
        ...(partnerContext?.market ? { partnerMarket: partnerContext.market } : {}),
        pricingMode: partnerContext ? "partner_rules" : "shopify_cart",
        cartDiscountSnapshot,
        // Split of discountAmount: the loyalty part is folded into Shopify line prices,
        // the rest is written as the promo code discount on the order.
        cartAutoDiscountCents: cartAutoDiscount,
        loyaltyDiscountCents: loyaltyDiscount,
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
  data: CheckoutSessionPatch,
  options?: { storefrontPricingToken?: string | null }
) {
  const existing = await prisma.checkoutSession.findUnique({
    where: { publicToken },
    include: { merchant: { select: { shopDomain: true } } },
  });
  if (!existing) throw new Error("Session not found");

  const effectiveShippingPayload = data.shippingPayload ?? existing.shippingPayload;
  const effectiveBranchRef =
    effectiveShippingPayload && typeof effectiveShippingPayload === "object"
      ? String((effectiveShippingPayload as { branchRef?: unknown }).branchRef ?? "").trim()
      : "";
  let verifiedBranchType: "branch" | "locker" | "courier" | null = null;
  if (effectiveBranchRef && (data.shippingPayload !== undefined || data.status === "READY")) {
    verifiedBranchType = await resolveNovaPoshtaBranchType({
      merchantId: existing.merchantId,
      branchRef: effectiveBranchRef,
    });
    if (!verifiedBranchType) {
      throw new CheckoutFulfillmentValidationError([
        "не вдалося підтвердити вибрану точку Нової Пошти",
      ]);
    }
    if (
      verifiedBranchType === "locker" &&
      !canUseNovaPoshtaPostomat({
        totalAmountCents: existing.totalAmount,
        shopifyCustomerGid: existing.shopifyCustomerGid,
      })
    ) {
      throw new CheckoutFulfillmentValidationError([novaPoshtaPostomatLimitMessage()]);
    }
  }

  const normalizedShippingPayload =
    data.shippingPayload && verifiedBranchType
      ? { ...data.shippingPayload, branchType: verifiedBranchType }
      : data.shippingPayload;
  const normalizedShippingMethodCode =
    verifiedBranchType === "locker"
      ? "nova_poshta_locker"
      : verifiedBranchType === "branch"
        ? "nova_poshta_branch"
        : data.shippingMethodCode;

  if (data.status && data.status !== existing.status) {
    assertTransition(existing.status, data.status);
  }
  if (data.status === "READY") {
    assertCheckoutReadyForFulfillment({
      buyerEmail: data.buyerEmail ?? existing.buyerEmail,
      buyerPhone: data.buyerPhone ?? existing.buyerPhone,
      buyerFirstName: data.buyerFirstName ?? existing.buyerFirstName,
      buyerLastName: data.buyerLastName ?? existing.buyerLastName,
      shippingProvider: data.shippingProvider ?? existing.shippingProvider,
      shippingMethodCode: normalizedShippingMethodCode ?? existing.shippingMethodCode,
      shippingPayload: normalizedShippingPayload ?? existing.shippingPayload,
    });
  }

  let mergedAttributes = {
    ...((existing.customAttributes ?? {}) as Record<string, unknown>),
    ...(data.customAttributes ?? {}),
  };
  let legalEntitySnapshot:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput
    | undefined =
    existing.legalEntitySnapshot === null
      ? Prisma.JsonNull
      : (existing.legalEntitySnapshot as Prisma.InputJsonValue);
  let legalEntityId =
    data.legalEntityId === undefined ? existing.legalEntityId : data.legalEntityId;
  const immutableLegalSnapshot =
    existing.status !== "DRAFT" && existing.legalEntitySnapshot !== null;

  if (data.legalEntityId) {
    if (
      !legalEntityV2Enabled() ||
      mergedAttributes.buyer_type !== "fop_company"
    ) {
      throw new LegalEntityAccessError("Legal entity selection is unavailable", 403);
    }
    if (
      immutableLegalSnapshot &&
      data.legalEntityId !== existing.legalEntityId
    ) {
      throw new LegalEntityAccessError(
        "Legal entity snapshot is immutable after checkout confirmation",
        409
      );
    }
    const token = options?.storefrontPricingToken?.trim();
    const identity = token
      ? verifyStorefrontPricingToken(token, existing.merchant.shopDomain)
      : null;
    if (
      !identity ||
      !existing.shopifyCustomerGid ||
      identity.customerGid !== existing.shopifyCustomerGid
    ) {
      throw new LegalEntityAccessError("Legal entity ownership could not be verified", 403);
    }
    if (!immutableLegalSnapshot) {
      const snapshot = await resolveOwnedLegalEntitySnapshot({
        merchantId: existing.merchantId,
        shopifyCustomerGid: identity.customerGid,
        legalEntityId: data.legalEntityId,
      });
      legalEntitySnapshot = snapshot as Prisma.InputJsonValue;
      mergedAttributes = {
        ...mergedAttributes,
        ...legacyAttributesFromSnapshot(snapshot),
      };
    }
  } else if (
    data.status === "READY" &&
    mergedAttributes.buyer_type === "fop_company" &&
    (!legalEntityId || data.legalEntityId === null) &&
    !immutableLegalSnapshot
  ) {
    const snapshot = snapshotFromLegacyAttributes(mergedAttributes);
    legalEntityId = null;
    legalEntitySnapshot = snapshot as Prisma.InputJsonValue;
    if (legalEntityV2Enabled()) {
      mergedAttributes = {
        ...mergedAttributes,
        ...legacyAttributesFromSnapshot(snapshot),
      };
    }
  }
  if (immutableLegalSnapshot) {
    const storedSnapshot = legalEntitySnapshotSchema.safeParse(
      existing.legalEntitySnapshot
    );
    if (storedSnapshot.success) {
      mergedAttributes = {
        ...mergedAttributes,
        ...legacyAttributesFromSnapshot(storedSnapshot.data),
      };
      legalEntityId = existing.legalEntityId;
      legalEntitySnapshot = existing.legalEntitySnapshot as Prisma.InputJsonValue;
    }
  }

  return prisma.checkoutSession.update({
    where: { publicToken },
    data: {
      buyerEmail: data.buyerEmail,
      buyerPhone: data.buyerPhone,
      buyerFirstName:
        data.buyerFirstName !== undefined
          ? normalizeUaPersonName(data.buyerFirstName) ?? null
          : undefined,
      buyerLastName:
        data.buyerLastName !== undefined
          ? normalizeUaPersonName(data.buyerLastName) ?? null
          : undefined,
      shippingMethodCode: normalizedShippingMethodCode,
      shippingProvider: data.shippingProvider,
      paymentProvider: data.paymentProvider as PaymentProvider | undefined,
      status: data.status as CheckoutStatus | undefined,
      customAttributes: data.customAttributes
        ? (mergedAttributes as Prisma.InputJsonValue)
        : undefined,
      legalEntityId,
      legalEntitySnapshot,
      shippingPayload: normalizedShippingPayload as Prisma.InputJsonValue | undefined,
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
  const code =
    typeof attrs.appliedDiscountCode === "string" ? attrs.appliedDiscountCode.trim() : "";
  if (code && !isPartnerProgramDiscountCode(code)) {
    await applyCheckoutDiscountCode(publicToken, code);
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
    /** Total discount: loyalty + promo code. */
    discountCents: number;
    promoTitle: string;
    pricingMode: string;
    loyaltyCents?: number;
    loyaltyTitle?: string;
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
  const loyaltyCents = Math.max(0, Math.round(input.loyaltyCents ?? 0));
  const promoCents = Math.max(0, input.discountCents - loyaltyCents);
  const isLoyaltyRow = (title: string) => /loyalty|лояльн/i.test(title);
  const discountRows: Array<{ title: string; amountCents: number }> = [];

  for (const row of existingSnapshot?.discountRows ?? []) {
    const title = String(row?.title ?? "").trim();
    const amountCents = Math.max(0, Math.round(row?.amountCents ?? 0));
    if (!title || amountCents <= 0 || title.startsWith(promoPrefix)) continue;
    // The cart row holds the pre-code tier; we re-add the re-evaluated one below.
    if (loyaltyCents > 0 && isLoyaltyRow(title)) continue;
    discountRows.push({ title, amountCents });
  }

  if (lineDiscountCents > 0 && !discountRows.some((row) => row.title === "Знижки на товари")) {
    discountRows.unshift({
      title: input.pricingMode === "partner_rules" ? "Партнерська знижка" : "Знижки на товари",
      amountCents: lineDiscountCents,
    });
  }

  if (loyaltyCents > 0) {
    discountRows.push({
      title: input.loyaltyTitle?.trim() || "Програма лояльності",
      amountCents: loyaltyCents,
    });
  }

  if (promoCents > 0) {
    discountRows.push({ title: input.promoTitle, amountCents: promoCents });
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
  if (isPartnerProgramDiscountCode(code)) {
    throw new CheckoutDiscountError(
      "Партнерська знижка застосовується автоматично після входу. Промокод PARTNER не потрібен."
    );
  }

  const discount = await fetchCheckoutDiscountByCode(session.merchantId, code);
  const subtotalCents = linesSubtotalCents(session.lines);
  const promoCents = computeCheckoutDiscountCents({
    subtotalCents,
    discount,
    eligibleSubtotalCents: eligibleSubtotalCents(session.lines, discount),
  });
  if (promoCents <= 0) {
    throw new CheckoutDiscountError("Промокод не дає знижки для поточного замовлення");
  }

  // The loyalty ladder the cart granted stays on top of the code, only its tier is
  // re-picked on the subtotal left after the code (see createSessionFromCart).
  const cartAutoDiscountCents = Math.max(
    0,
    Math.round(typeof attrs.cartAutoDiscountCents === "number" ? attrs.cartAutoDiscountCents : 0)
  );
  const reevaluated =
    cartAutoDiscountCents > 0
      ? computeLoyaltyDiscount(
          await fetchOrderLoyaltyLadder(session.merchantId),
          Math.max(0, subtotalCents - promoCents)
        )
      : { tier: null, discountCents: 0 };
  const loyaltyCents = reevaluated.discountCents;
  const discountCents = promoCents + loyaltyCents;

  const promoTitle = promoDiscountRowTitle(code, discount.title);
  const cartDiscountSnapshot = buildPromoCartDiscountSnapshot(session, {
    discountCents,
    promoTitle,
    pricingMode,
    loyaltyCents,
    loyaltyTitle: reevaluated.tier?.title ?? "",
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
        loyaltyDiscountCents: loyaltyCents,
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
      "entity_type",
      "short_name",
      "vat_number",
      "actual_address",
      "contact_name",
      "contact_email",
      "contact_phone",
      "iban",
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
    postomatAllowed: canUseNovaPoshtaPostomat({
      totalAmountCents: session.totalAmount,
      shopifyCustomerGid: session.shopifyCustomerGid,
    }),
    customAttributes: editableAttributes,
    legalEntityId: session.legalEntityId,
    legalEntityV2Enabled: legalEntityV2Enabled(),
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
    orderLink: session.orderLink
      ? {
          shopifyOrderName: session.orderLink.shopifyOrderName,
          fiscalReceipt: session.orderLink.fiscalReceipt,
        }
      : null,
  };
}
