import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  type Row = {
    id: string;
    merchantId: string;
    shopifyCustomerGid: string;
    entityType: string;
    legalName: string;
    shortName: string | null;
    normalizedTaxId: string;
    taxId: string;
    vatNumber: string | null;
    legalAddress: string;
    actualAddress: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    iban: string | null;
    isDefault: boolean;
    deletedAt: Date | null;
    createdAt: Date;
  };
  const rows: Row[] = [];
  let sequence = 0;
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === "id" && typeof value === "object" && value) {
        return row.id !== (value as { not: string }).not;
      }
      return row[key as keyof Row] === value;
    });
  const entity = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? { ...row } : null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => matches(row, where))
    ),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => matches(row, where)).length
    ),
    create: vi.fn(async ({ data }: { data: Omit<Row, "id" | "deletedAt" | "createdAt"> }) => {
      const row: Row = {
        ...data,
        id: `entity-${++sequence}`,
        deletedAt: null,
        createdAt: new Date(sequence),
      };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        const selected = rows.filter((row) => matches(row, where));
        selected.forEach((row) => Object.assign(row, data));
        return { count: selected.length };
      }
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("missing row");
        Object.assign(row, data);
        return row;
      }
    ),
  };
  return {
    rows,
    entity,
    reset() {
      rows.splice(0);
      sequence = 0;
      Object.values(entity).forEach((mock) => mock.mockClear());
    },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    customerLegalEntity: database.entity,
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ customerLegalEntity: database.entity })
    ),
  },
}));

import {
  createLegalEntity,
  deleteLegalEntity,
  resolveOwnedLegalEntitySnapshot,
  updateLegalEntity,
} from "@/lib/legal-entities/service";
import {
  LEGAL_ENTITY_TRANSPORT_ATTRIBUTE,
  legalEntityTransport,
  normalizeTaxId,
  parseLegalEntityTransport,
  snapshotFromLegacyAttributes,
} from "@/lib/legal-entities/model";
import { mapCheckoutToOrderCreateInput } from "@/lib/shopify/order-mapper";

const owner = {
  merchantId: "merchant-a",
  shopifyCustomerGid: "gid://shopify/Customer/1",
};

const baseInput = {
  entityType: "LEGAL_PERSON" as const,
  legalName: "ТОВ «Компанія»",
  shortName: "ТОВ Компанія",
  taxId: "12 34-56-78",
  vatNumber: null,
  legalAddress: "м. Київ, вул. Тестова, 1",
  actualAddress: null,
  contactName: "Ірина Коваль",
  contactPhone: "+380671234567",
  contactEmail: "office@example.com",
  iban: "UA123456789012345678901234567",
};

describe("customer legal entities", () => {
  beforeEach(() => {
    database.reset();
    process.env.DILOVOD_LEGAL_ENTITY_V2_ENABLED = "true";
  });

  it("normalizes tax IDs and supports multiple cards with one default", async () => {
    expect(normalizeTaxId(baseInput.taxId)).toBe("12345678");
    const first = await createLegalEntity(owner, baseInput);
    const second = await createLegalEntity(owner, {
      ...baseInput,
      legalName: "ФОП Іваненко Іван",
      entityType: "FOP",
      taxId: "1234567890",
    });

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    expect(database.rows).toHaveLength(2);

    await updateLegalEntity(owner, second.id, { isDefault: true });
    expect(database.rows.find((row) => row.id === first.id)?.isDefault).toBe(false);
    expect(database.rows.find((row) => row.id === second.id)?.isDefault).toBe(true);
  });

  it("enforces merchant/customer ownership and keeps an immutable order snapshot", async () => {
    const created = await createLegalEntity(owner, baseInput);
    const snapshot = await resolveOwnedLegalEntitySnapshot({
      ...owner,
      legalEntityId: created.id,
    });
    await expect(
      resolveOwnedLegalEntitySnapshot({
        merchantId: "merchant-b",
        shopifyCustomerGid: owner.shopifyCustomerGid,
        legalEntityId: created.id,
      })
    ).rejects.toMatchObject({ status: 404 });

    await updateLegalEntity(owner, created.id, { legalName: "ТОВ «Нове ім’я»" });
    expect(snapshot.legalName).toBe("ТОВ «Компанія»");
    expect(database.rows[0].legalName).toBe("ТОВ «Нове ім’я»");
  });

  it("soft-deletes a card and assigns a replacement default", async () => {
    const first = await createLegalEntity(owner, baseInput);
    const second = await createLegalEntity(owner, {
      ...baseInput,
      taxId: "1234567890",
      entityType: "FOP",
      legalName: "ФОП Іваненко Іван",
    });
    await deleteLegalEntity(owner, first.id);
    expect(database.rows.find((row) => row.id === first.id)?.deletedAt).toBeInstanceOf(Date);
    expect(database.rows.find((row) => row.id === second.id)?.isDefault).toBe(true);
  });

  it("builds a guest snapshot without creating a permanent card", () => {
    const snapshot = snapshotFromLegacyAttributes({
      buyer_type: "fop_company",
      fop_name: "ФОП Іваненко Іван",
      fop_tax_id: "1234567890",
      fop_legal_address: "м. Київ, вул. Тестова, 1",
      docs_email: "docs@example.com",
      docs_phone: "+380671234567",
    });
    expect(snapshot.entityType).toBe("FOP");
    expect(database.rows).toHaveLength(0);
  });

  it("rejects an obviously incomplete FOP legal name", async () => {
    await expect(
      createLegalEntity(owner, {
        ...baseInput,
        entityType: "FOP",
        taxId: "1234567890",
        legalName: "ФОП МИКИТА",
      })
    ).rejects.toThrow("прізвище та ім’я");
  });

  it("adds the versioned snapshot to Shopify custom attributes", () => {
    const snapshot = snapshotFromLegacyAttributes({
      buyer_type: "fop_company",
      fop_name: "ТОВ «Компанія»",
      fop_tax_id: "12345678",
      fop_legal_address: "м. Київ, вул. Тестова, 1",
    });
    expect(parseLegalEntityTransport(legalEntityTransport(snapshot))).toEqual(snapshot);

    const order = mapCheckoutToOrderCreateInput(
      {
        id: "session-1",
        merchantId: "merchant-a",
        publicToken: "token",
        status: "READY",
        sourceIdentifier: "checkout-1",
        currency: "UAH",
        subtotal: 10000,
        shippingAmount: 0,
        discountAmount: 0,
        totalAmount: 10000,
        buyerEmail: "buyer@example.com",
        buyerPhone: "+380671234567",
        buyerFirstName: "Ірина",
        buyerLastName: "Коваль",
        shippingMethodCode: "nova_poshta_branch",
        shippingProvider: "nova_poshta",
        shippingPayload: {},
        billingPayload: null,
        paymentProvider: null,
        customAttributes: { buyer_type: "fop_company" },
        shopifyCustomerGid: owner.shopifyCustomerGid,
        legalEntityId: "f1667e64-0fc5-4f6b-a62d-3db1b9799c08",
        legalEntitySnapshot: snapshot,
        createdAt: new Date(),
        updatedAt: new Date(),
        abandonedAt: null,
        lines: [],
        paymentAttempts: [],
      },
      null,
      { financialStatus: "PENDING", includeShippingLines: false }
    );
    expect(
      order.customAttributes.find(
        (attribute) => attribute.key === LEGAL_ENTITY_TRANSPORT_ATTRIBUTE
      )?.value
    ).toBe(legalEntityTransport(snapshot));
    expect(
      order.customAttributes.find(
        (attribute) => attribute.key === "delivery_address_v1"
      )?.value
    ).toContain('"version":1');
  });
});
