import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyStorefrontPricingToken } from "@/lib/checkout/storefront-pricing-token";
import {
  legalEntityInputSchema,
  legalEntityPatchSchema,
  maskedTaxId,
  snapshotFromLegalEntity,
  type LegalEntityInput,
} from "@/lib/legal-entities/model";

export class LegalEntityAccessError extends Error {
  constructor(message: string, public readonly status = 403) {
    super(message);
  }
}

export async function authenticateLegalEntityToken(rawAuthorization: string | null) {
  const token = rawAuthorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new LegalEntityAccessError("Customer authentication required", 401);

  const payload = verifyStorefrontPricingToken(token);
  if (!payload) throw new LegalEntityAccessError("Customer authentication expired", 401);

  const merchant = await prisma.merchant.findUnique({
    where: { shopDomain: payload.shop },
    select: { id: true, shopDomain: true },
  });
  if (!merchant) throw new LegalEntityAccessError("Merchant not found", 404);

  return {
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    shopifyCustomerGid: payload.customerGid,
  };
}

export async function listLegalEntities(identity: {
  merchantId: string;
  shopifyCustomerGid: string;
}) {
  const rows = await prisma.customerLegalEntity.findMany({
    where: {
      merchantId: identity.merchantId,
      shopifyCustomerGid: identity.shopifyCustomerGid,
      deletedAt: null,
    },
    orderBy: [{ isDefault: "desc" }, { legalName: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(publicLegalEntity);
}

export async function createLegalEntity(
  identity: { merchantId: string; shopifyCustomerGid: string },
  raw: unknown
) {
  const input = legalEntityInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.customerLegalEntity.findFirst({
      where: {
        merchantId: identity.merchantId,
        shopifyCustomerGid: identity.shopifyCustomerGid,
        normalizedTaxId: input.taxId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) throw new LegalEntityAccessError("Legal entity already exists", 409);

    const activeCount = await tx.customerLegalEntity.count({
      where: {
        merchantId: identity.merchantId,
        shopifyCustomerGid: identity.shopifyCustomerGid,
        deletedAt: null,
      },
    });
    const isDefault = input.isDefault === true || activeCount === 0;
    if (isDefault) {
      await clearDefault(tx, identity);
    }
    const row = await tx.customerLegalEntity.create({
      data: entityCreateData(identity, input, isDefault),
    });
    return publicLegalEntity(row);
  }, { isolationLevel: "Serializable" });
}

export async function updateLegalEntity(
  identity: { merchantId: string; shopifyCustomerGid: string },
  id: string,
  raw: unknown
) {
  const patch = legalEntityPatchSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const current = await tx.customerLegalEntity.findFirst({
      where: {
        id,
        merchantId: identity.merchantId,
        shopifyCustomerGid: identity.shopifyCustomerGid,
        deletedAt: null,
      },
    });
    if (!current) throw new LegalEntityAccessError("Legal entity not found", 404);

    const merged = legalEntityInputSchema.parse({
      entityType: patch.entityType ?? current.entityType,
      legalName: patch.legalName ?? current.legalName,
      shortName: patch.shortName === undefined ? current.shortName : patch.shortName,
      taxId: patch.taxId ?? current.taxId,
      vatNumber: patch.vatNumber === undefined ? current.vatNumber : patch.vatNumber,
      legalAddress: patch.legalAddress ?? current.legalAddress,
      actualAddress:
        patch.actualAddress === undefined ? current.actualAddress : patch.actualAddress,
      contactName: patch.contactName === undefined ? current.contactName : patch.contactName,
      contactPhone:
        patch.contactPhone === undefined ? current.contactPhone : patch.contactPhone,
      contactEmail:
        patch.contactEmail === undefined ? current.contactEmail : patch.contactEmail,
      iban: patch.iban === undefined ? current.iban : patch.iban,
      isDefault: patch.isDefault ?? current.isDefault,
    });
    const normalizedTaxId = merged.taxId;
    if (normalizedTaxId !== current.normalizedTaxId) {
      const duplicate = await tx.customerLegalEntity.findFirst({
        where: {
          id: { not: id },
          merchantId: identity.merchantId,
          shopifyCustomerGid: identity.shopifyCustomerGid,
          normalizedTaxId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) throw new LegalEntityAccessError("Legal entity already exists", 409);
    }

    if (patch.isDefault === true) {
      await clearDefault(tx, identity);
    }
    const row = await tx.customerLegalEntity.update({
      where: { id },
      data: {
        ...patch,
        ...(patch.taxId !== undefined
          ? { taxId: patch.taxId, normalizedTaxId }
          : {}),
        ...(patch.isDefault === false && current.isDefault
          ? { isDefault: true }
          : {}),
      },
    });
    return publicLegalEntity(row);
  }, { isolationLevel: "Serializable" });
}

export async function deleteLegalEntity(
  identity: { merchantId: string; shopifyCustomerGid: string },
  id: string
) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.customerLegalEntity.findFirst({
      where: {
        id,
        merchantId: identity.merchantId,
        shopifyCustomerGid: identity.shopifyCustomerGid,
        deletedAt: null,
      },
    });
    if (!current) throw new LegalEntityAccessError("Legal entity not found", 404);
    await tx.customerLegalEntity.update({
      where: { id },
      data: { deletedAt: new Date(), isDefault: false },
    });
    if (current.isDefault) {
      const next = await tx.customerLegalEntity.findFirst({
        where: {
          id: { not: id },
          merchantId: identity.merchantId,
          shopifyCustomerGid: identity.shopifyCustomerGid,
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (next) {
        await tx.customerLegalEntity.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
  }, { isolationLevel: "Serializable" });
}

export async function resolveOwnedLegalEntitySnapshot(input: {
  merchantId: string;
  shopifyCustomerGid: string;
  legalEntityId: string;
}) {
  const entity = await prisma.customerLegalEntity.findFirst({
    where: {
      id: input.legalEntityId,
      merchantId: input.merchantId,
      shopifyCustomerGid: input.shopifyCustomerGid,
      deletedAt: null,
    },
  });
  if (!entity) throw new LegalEntityAccessError("Legal entity not found", 404);
  return snapshotFromLegalEntity(entity);
}

function entityCreateData(
  identity: { merchantId: string; shopifyCustomerGid: string },
  input: LegalEntityInput,
  isDefault: boolean
) {
  return {
    merchantId: identity.merchantId,
    shopifyCustomerGid: identity.shopifyCustomerGid,
    entityType: input.entityType,
    legalName: input.legalName,
    shortName: input.shortName ?? null,
    normalizedTaxId: input.taxId,
    taxId: input.taxId,
    vatNumber: input.vatNumber ?? null,
    legalAddress: input.legalAddress,
    actualAddress: input.actualAddress ?? null,
    contactName: input.contactName ?? null,
    contactPhone: input.contactPhone ?? null,
    contactEmail: input.contactEmail ?? null,
    iban: input.iban ?? null,
    isDefault,
  };
}

async function clearDefault(
  tx: Prisma.TransactionClient,
  identity: { merchantId: string; shopifyCustomerGid: string }
) {
  await tx.customerLegalEntity.updateMany({
    where: {
      merchantId: identity.merchantId,
      shopifyCustomerGid: identity.shopifyCustomerGid,
      deletedAt: null,
      isDefault: true,
    },
    data: { isDefault: false },
  });
}

function publicLegalEntity(entity: {
  id: string;
  entityType: string;
  legalName: string;
  shortName: string | null;
  taxId: string;
  vatNumber: string | null;
  legalAddress: string;
  actualAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  iban: string | null;
  isDefault: boolean;
}) {
  return {
    id: entity.id,
    entityType: entity.entityType,
    legalName: entity.legalName,
    shortName: entity.shortName,
    maskedTaxId: maskedTaxId(entity.taxId),
    taxId: entity.taxId,
    vatNumber: entity.vatNumber,
    legalAddress: entity.legalAddress,
    actualAddress: entity.actualAddress,
    contactName: entity.contactName,
    contactPhone: entity.contactPhone,
    contactEmail: entity.contactEmail,
    iban: entity.iban,
    isDefault: entity.isDefault,
  };
}
