type CheckoutLineLike = {
  quantity: number;
  unitPrice: number;
  compareAtPrice?: number | null;
  metadata?: unknown;
};

type SessionLike = {
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  lines: CheckoutLineLike[];
};

export type DiscountRow = {
  title: string;
  amountCents: number;
};

export type SavingsSummary = {
  grossSubtotalCents: number;
  discountRows: DiscountRow[];
  totalSavingsCents: number;
  totalDueCents: number;
  pricingMode: string;
};

type CartDiscountSnapshot = {
  grossSubtotalCents?: number;
  discountRows?: Array<{ title?: string; amountCents?: number; amount?: number }>;
  totalDueCents?: number;
  pricingMode?: string;
};

function lineCatalogCents(line: CheckoutLineLike): number {
  const metadata = (line.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.catalogUnitPriceCents === "number" && metadata.catalogUnitPriceCents > 0) {
    return Math.round(metadata.catalogUnitPriceCents);
  }
  if (typeof line.compareAtPrice === "number" && line.compareAtPrice > line.unitPrice) {
    return Math.round(line.compareAtPrice);
  }
  return Math.round(line.unitPrice);
}

function normalizeRows(rows: CartDiscountSnapshot["discountRows"]): DiscountRow[] {
  return (rows ?? [])
    .map((row) => ({
      title: String(row?.title ?? "Знижка").trim() || "Знижка",
      amountCents: Math.max(
        0,
        Math.round(typeof row?.amountCents === "number" ? row.amountCents : row?.amount ?? 0)
      ),
    }))
    .filter((row) => row.amountCents > 0);
}

function fallbackRows(session: SessionLike, pricingMode: string): DiscountRow[] {
  const grossSubtotalCents = session.lines.reduce(
    (sum, line) => sum + lineCatalogCents(line) * line.quantity,
    0
  );
  const lineDiscountCents = Math.max(0, grossSubtotalCents - session.subtotal);
  const cartDiscountCents = Math.max(0, session.discountAmount);
  const rows: DiscountRow[] = [];

  if (pricingMode === "partner_rules" && lineDiscountCents > 0) {
    rows.push({ title: "Партнерська знижка", amountCents: lineDiscountCents });
  } else {
    if (lineDiscountCents > 0) {
      rows.push({ title: "Знижки на товари", amountCents: lineDiscountCents });
    }
    if (cartDiscountCents > 0) {
      rows.push({ title: "Промокод / додаткова знижка", amountCents: cartDiscountCents });
    }
  }

  return rows;
}

export function buildSavingsSummary(
  session: SessionLike,
  customAttributes?: Record<string, unknown> | null
): SavingsSummary | null {
  const attrs = customAttributes ?? {};
  const pricingMode =
    typeof attrs.pricingMode === "string" ? attrs.pricingMode : "shopify_cart";
  const snapshot = (attrs.cartDiscountSnapshot ?? null) as CartDiscountSnapshot | null;

  const grossFromLines = session.lines.reduce(
    (sum, line) => sum + lineCatalogCents(line) * line.quantity,
    0
  );
  const grossSubtotalCents =
    typeof snapshot?.grossSubtotalCents === "number" && snapshot.grossSubtotalCents > 0
      ? Math.round(snapshot.grossSubtotalCents)
      : grossFromLines;

  let discountRows = normalizeRows(snapshot?.discountRows);
  const snapshotTotal = discountRows.reduce((sum, row) => sum + row.amountCents, 0);
  const expectedSavings = Math.max(0, grossSubtotalCents - session.totalAmount);

  if (!discountRows.length || Math.abs(snapshotTotal - expectedSavings) > Math.max(100, expectedSavings * 0.05)) {
    discountRows = fallbackRows(session, pricingMode);
  }

  const totalSavingsCents = discountRows.reduce((sum, row) => sum + row.amountCents, 0);
  if (totalSavingsCents <= 0 || grossSubtotalCents <= session.totalAmount) {
    return null;
  }

  return {
    grossSubtotalCents,
    discountRows,
    totalSavingsCents,
    totalDueCents: session.totalAmount,
    pricingMode,
  };
}
