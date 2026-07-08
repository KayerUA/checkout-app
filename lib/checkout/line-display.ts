export type CheckoutLineMetadata = {
  imageUrl?: string | null;
  imageAlt?: string | null;
  productHandle?: string | null;
  dilovodInvoiceName?: string | null;
};

export function getCheckoutLineInvoiceTitle(line: {
  title: string;
  metadata?: unknown;
}): string {
  const metadata = (line.metadata ?? {}) as CheckoutLineMetadata;
  const dilovodName = metadata.dilovodInvoiceName?.trim();
  return dilovodName || line.title;
}

export function resolveInvoiceLineTitle(line: {
  title: string;
  dilovodInvoiceName?: string | null;
}): string {
  const dilovodName = line.dilovodInvoiceName?.trim();
  return dilovodName || line.title;
}
