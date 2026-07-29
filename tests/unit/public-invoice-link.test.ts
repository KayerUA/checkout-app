import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_URL: "https://checkout.kayer.ua",
    SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  }),
}));

import {
  invoiceDocumentIdFromToken,
  publicInvoiceToken,
  publicInvoiceUrl,
} from "@/lib/documents/public-invoice-link";

describe("public invoice links", () => {
  const documentId = "550e8400-e29b-41d4-a716-446655440000";

  it("creates a stable short URL and verifies its token", () => {
    const token = publicInvoiceToken(documentId);

    expect(publicInvoiceUrl(documentId)).toBe(
      `https://checkout.kayer.ua/i/${token}`,
    );
    expect(invoiceDocumentIdFromToken(token)).toBe(documentId);
  });

  it("rejects a modified or malformed token", () => {
    const token = publicInvoiceToken(documentId);

    expect(invoiceDocumentIdFromToken(`${token}x`)).toBeNull();
    expect(invoiceDocumentIdFromToken("not-an-invoice")).toBeNull();
  });
});
