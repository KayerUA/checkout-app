export type FiscalizationProvider = {
  createReceipt(order: unknown): Promise<{ externalId?: string; url?: string } | null>;
  createRefundReceipt(order: unknown, refund: unknown): Promise<{ externalId?: string; url?: string } | null>;
};

export class NoopFiscalizationProvider implements FiscalizationProvider {
  async createReceipt() {
    return null;
  }

  async createRefundReceipt() {
    return null;
  }
}

export function getFiscalizationProvider(): FiscalizationProvider {
  return new NoopFiscalizationProvider();
}
