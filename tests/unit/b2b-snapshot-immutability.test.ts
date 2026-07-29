import { describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn(async (args: unknown) => args));

vi.mock("@/lib/db", () => ({
  prisma: {
    b2BOrder: { upsert },
  },
}));

import { upsertB2BOrder } from "@/lib/b2b/orders";

describe("B2B legal snapshot immutability", () => {
  it("writes the snapshot on create but never overwrites it on later webhooks", async () => {
    const snapshot = {
      version: 1 as const,
      entityType: "LEGAL_PERSON" as const,
      legalName: "ТОВ «Компанія»",
      shortName: null,
      taxId: "12345678",
      normalizedTaxId: "12345678",
      vatNumber: null,
      legalAddress: "м. Київ, вул. Тестова, 1",
      actualAddress: null,
      contactName: null,
      contactPhone: null,
      contactEmail: "office@example.com",
      iban: null,
    };
    await upsertB2BOrder(
      {
        id: 1001,
        name: "#1001",
        total_price: "100.00",
        currency: "UAH",
      },
      {
        buyer_type: "fop_company",
        payment_preference: "bank_invoice",
        fop_name: snapshot.legalName,
        fop_tax_id: snapshot.taxId,
        fop_legal_address: snapshot.legalAddress,
        legal_entity_id: "f1667e64-0fc5-4f6b-a62d-3db1b9799c08",
        legal_entity_snapshot: snapshot,
      },
      "CREATED"
    );
    const call = upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.create.legalEntitySnapshot).toEqual(snapshot);
    expect(call.create.legalEntityId).toBe("f1667e64-0fc5-4f6b-a62d-3db1b9799c08");
    expect(call.update).not.toHaveProperty("legalEntitySnapshot");
    expect(call.update).not.toHaveProperty("legalEntityId");
  });
});
