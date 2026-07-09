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
};

/** Partner / cart discounts: accept Shopify cart unit price when below catalog. */
export function applyCartUnitPriceHint(input: {
  catalogUnitPriceCents: number;
  quantity: number;
  unitPriceCents?: number;
  originalUnitPriceCents?: number;
  /** Lowest allowed fraction of catalog (0.5 = up to 50% off). */
  minFractionOfCatalog?: number;
}): ResolvedCartLinePricing {
  const catalog = Math.max(0, Math.round(input.catalogUnitPriceCents));
  const quantity = Math.max(1, input.quantity);
  const hinted = input.unitPriceCents;
  const minAllowed = Math.floor(catalog * (input.minFractionOfCatalog ?? 0.5));

  if (
    typeof hinted === "number" &&
    Number.isFinite(hinted) &&
    hinted > 0 &&
    hinted <= catalog &&
    hinted >= minAllowed
  ) {
    const originalHint = input.originalUnitPriceCents;
    const compareAt =
      typeof originalHint === "number" && originalHint >= catalog ? originalHint : catalog;
    return {
      unitPrice: Math.round(hinted),
      compareAtPrice: compareAt > hinted ? compareAt : catalog,
      lineDiscountAmount: 0,
    };
  }

  return {
    unitPrice: catalog,
    compareAtPrice: catalog || null,
    lineDiscountAmount: 0,
  };
}
