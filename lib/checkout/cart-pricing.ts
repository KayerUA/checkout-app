export type CartLinePriceHint = {
  variantGid: string;
  quantity: number;
  unitPriceCents?: number;
  originalUnitPriceCents?: number;
};

export type ResolvedCartLinePricing = {
  unitPrice: number;
  compareAtPrice: number | null;
  lineDiscountAmount: number;
  usedCartHint: boolean;
};

export type PricingSource = "catalog" | "partner_rules" | "shopify_cart";

/** Retail / promo: accept Shopify cart unit price when below catalog. */
export function applyCartUnitPriceHint(input: {
  catalogUnitPriceCents: number;
  quantity: number;
  unitPriceCents?: number;
  originalUnitPriceCents?: number;
}): ResolvedCartLinePricing {
  const catalog = Math.max(0, Math.round(input.catalogUnitPriceCents));
  const hinted = input.unitPriceCents;
  const originalHint = input.originalUnitPriceCents;
  const originalMatchesCatalog =
    typeof originalHint !== "number" ||
    originalHint <= 0 ||
    Math.abs(originalHint - catalog) <= Math.max(100, Math.round(catalog * 0.05));

  if (
    typeof hinted === "number" &&
    Number.isFinite(hinted) &&
    hinted > 0 &&
    hinted <= catalog &&
    originalMatchesCatalog
  ) {
    const compareAt =
      typeof originalHint === "number" && originalHint >= catalog ? originalHint : catalog;
    return {
      unitPrice: Math.round(hinted),
      compareAtPrice: compareAt > hinted ? compareAt : catalog,
      lineDiscountAmount: 0,
      usedCartHint: true,
    };
  }

  return {
    unitPrice: catalog,
    compareAtPrice: catalog || null,
    lineDiscountAmount: 0,
    usedCartHint: false,
  };
}

/** Reject cart hints if line totals do not match Shopify cart subtotal. */
export function cartSubtotalMatchesHint(
  lines: Array<Pick<ResolvedCartLinePricing, "unitPrice" | "lineDiscountAmount"> & { quantity: number }>,
  cartItemsSubtotalCents?: number
): boolean {
  if (typeof cartItemsSubtotalCents !== "number" || !Number.isFinite(cartItemsSubtotalCents)) {
    return true;
  }
  const computed = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity - line.lineDiscountAmount,
    0
  );
  const tolerance = Math.max(100, Math.round(cartItemsSubtotalCents * 0.01));
  return Math.abs(computed - Math.round(cartItemsSubtotalCents)) <= tolerance;
}

/** Cart-level codes (KAYERUA5 etc.) not always visible per line — remainder as session discount. */
export function computeCartLevelDiscountCents(
  linesSubtotalCents: number,
  cartTotalCents?: number
): number {
  if (typeof cartTotalCents !== "number" || !Number.isFinite(cartTotalCents)) return 0;
  return Math.max(0, Math.round(linesSubtotalCents) - Math.round(cartTotalCents));
}

export function cartTotalMatchesExpected(
  linesSubtotalCents: number,
  cartLevelDiscountCents: number,
  cartTotalCents?: number
): boolean {
  if (typeof cartTotalCents !== "number" || !Number.isFinite(cartTotalCents)) return true;
  const expected = Math.max(0, linesSubtotalCents - cartLevelDiscountCents);
  const tolerance = Math.max(100, Math.round(cartTotalCents * 0.01));
  return Math.abs(expected - Math.round(cartTotalCents)) <= tolerance;
}
