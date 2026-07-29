import { z } from "zod";
import { normalizeUaPhone } from "@/lib/checkout/phone";

export const LEGAL_ENTITY_SNAPSHOT_VERSION = 1 as const;
export const LEGAL_ENTITY_TRANSPORT_ATTRIBUTE = "legal_entity_v1";

export function legalEntityV2Enabled() {
  return ["1", "true", "yes", "on"].includes(
    (process.env.DILOVOD_LEGAL_ENTITY_V2_ENABLED ?? "false").trim().toLowerCase()
  );
}

export function normalizeTaxId(value: string) {
  return value.replace(/\D/g, "");
}

export function isObviouslyIncompleteFopLegalName(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(
      /^(?:ФОП|ФІЗИЧНА\s+ОСОБА[\s-]*ПІДПРИЄМЕЦЬ)\s*[:—-]?\s*/iu,
      ""
    );
  return normalized.split(" ").filter((part) => part.length >= 2).length < 2;
}

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value == null || String(value).trim() === "" ? null : String(value).trim()),
    z.string().max(max).nullable()
  );

const optionalPhone = z.preprocess(
  (value) => (value == null || String(value).trim() === "" ? null : String(value)),
  z
    .string()
    .max(32)
    .nullable()
    .transform((value, context) => {
      if (!value) return null;
      const normalized = normalizeUaPhone(value);
      if (normalized) return normalized;
      context.addIssue({
        code: "custom",
        message: "Вкажіть український номер у форматі +380XXXXXXXXX",
      });
      return z.NEVER;
    })
);

const optionalEmail = z.preprocess(
  (value) => (value == null || String(value).trim() === "" ? null : String(value).trim()),
  z.string().email().max(254).nullable()
);

const optionalIban = z.preprocess(
  (value) =>
    value == null || String(value).trim() === ""
      ? null
      : String(value).replace(/\s/g, "").toUpperCase(),
  z
    .string()
    .min(15)
    .max(34)
    .regex(/^[A-Z]{2}\d{2}[A-Z0-9]+$/, "Некоректний формат IBAN")
    .nullable()
);

const legalEntityObjectSchema = z
  .object({
    entityType: z.enum(["FOP", "LEGAL_PERSON"]),
    legalName: z.string().trim().min(3).max(160),
    shortName: optionalText(160).optional(),
    taxId: z
      .string()
      .trim()
      .max(20)
      .transform(normalizeTaxId)
      .refine((value) => value.length === 8 || value.length === 10, {
        message: "ЄДРПОУ має містити 8 цифр, ІПН/РНОКПП — 10 цифр",
      }),
    vatNumber: optionalText(20).optional(),
    legalAddress: z.string().trim().min(8).max(500),
    actualAddress: optionalText(500).optional(),
    contactName: optionalText(160).optional(),
    contactPhone: optionalPhone.optional(),
    contactEmail: optionalEmail.optional(),
    iban: optionalIban.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

function taxIdMatchesEntityType(value: {
  entityType?: "FOP" | "LEGAL_PERSON";
  taxId?: string;
}) {
  if (!value.entityType || !value.taxId) return true;
  return value.entityType === "LEGAL_PERSON"
    ? value.taxId.length === 8
    : value.taxId.length === 10;
}

export const legalEntityInputSchema = legalEntityObjectSchema.refine(
  taxIdMatchesEntityType,
  {
    path: ["taxId"],
    message: "Для юридичної особи потрібен ЄДРПОУ з 8 цифр, для ФОП — ІПН з 10 цифр",
  }
).refine(
  (value) =>
    value.entityType !== "FOP" ||
    !isObviouslyIncompleteFopLegalName(value.legalName),
  {
    path: ["legalName"],
    message: "Вкажіть повне найменування ФОП, щонайменше прізвище та ім’я",
  }
);

export const legalEntityPatchSchema = legalEntityObjectSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "No fields to update"
);

export const legalEntitySnapshotSchema = z
  .object({
    version: z.literal(LEGAL_ENTITY_SNAPSHOT_VERSION),
    entityType: z.enum(["FOP", "LEGAL_PERSON"]),
    legalName: z.string().trim().min(3).max(160),
    shortName: z.string().max(160).nullable(),
    taxId: z.string().min(1).max(20),
    normalizedTaxId: z.string().regex(/^(?:\d{8}|\d{10})$/),
    vatNumber: z.string().max(20).nullable(),
    legalAddress: z.string().trim().min(8).max(500),
    actualAddress: z.string().max(500).nullable(),
    contactName: z.string().max(160).nullable(),
    contactPhone: z.string().max(32).nullable(),
    contactEmail: z.string().email().max(254).nullable(),
    iban: z.string().max(34).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.entityType === "LEGAL_PERSON"
        ? value.normalizedTaxId.length === 8
        : value.normalizedTaxId.length === 10,
    {
      path: ["normalizedTaxId"],
      message: "Tax ID does not match legal entity type",
    }
  )
  .refine(
    (value) =>
      value.entityType !== "FOP" ||
      !isObviouslyIncompleteFopLegalName(value.legalName),
    {
      path: ["legalName"],
      message: "FOP legal name is obviously incomplete",
    }
  );

export type LegalEntityInput = z.infer<typeof legalEntityInputSchema>;
export type LegalEntitySnapshot = z.infer<typeof legalEntitySnapshotSchema>;

export type LegalEntityRecord = {
  id: string;
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
};

export function snapshotFromLegalEntity(entity: LegalEntityRecord): LegalEntitySnapshot {
  return legalEntitySnapshotSchema.parse({
    version: LEGAL_ENTITY_SNAPSHOT_VERSION,
    entityType: entity.entityType,
    legalName: entity.legalName,
    shortName: entity.shortName,
    taxId: entity.taxId,
    normalizedTaxId: entity.normalizedTaxId,
    vatNumber: entity.vatNumber,
    legalAddress: entity.legalAddress,
    actualAddress: entity.actualAddress,
    contactName: entity.contactName,
    contactPhone: entity.contactPhone,
    contactEmail: entity.contactEmail,
    iban: entity.iban,
  });
}

export function snapshotFromLegacyAttributes(
  attrs: Record<string, unknown>
): LegalEntitySnapshot {
  const normalizedTaxId = normalizeTaxId(String(attrs.fop_tax_id ?? ""));
  return legalEntitySnapshotSchema.parse({
    version: LEGAL_ENTITY_SNAPSHOT_VERSION,
    entityType:
      attrs.entity_type === "LEGAL_PERSON" || normalizedTaxId.length === 8
        ? "LEGAL_PERSON"
        : "FOP",
    legalName: String(attrs.fop_name ?? "").trim(),
    shortName: stringOrNull(attrs.short_name),
    taxId: String(attrs.fop_tax_id ?? "").trim(),
    normalizedTaxId,
    vatNumber: stringOrNull(attrs.vat_number),
    legalAddress: String(attrs.fop_legal_address ?? "").trim(),
    actualAddress: stringOrNull(attrs.actual_address),
    contactName: stringOrNull(attrs.contact_name),
    contactPhone:
      normalizeUaPhone(String(attrs.contact_phone ?? attrs.docs_phone ?? "")) ?? null,
    contactEmail: stringOrNull(attrs.contact_email ?? attrs.docs_email),
    iban: stringOrNull(attrs.iban)?.replace(/\s/g, "").toUpperCase() ?? null,
  });
}

export function parseLegalEntityTransport(value: unknown): LegalEntitySnapshot | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return legalEntitySnapshotSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function legalEntityTransport(snapshot: LegalEntitySnapshot) {
  return JSON.stringify(legalEntitySnapshotSchema.parse(snapshot));
}

export function legacyAttributesFromSnapshot(snapshot: LegalEntitySnapshot) {
  return {
    entity_type: snapshot.entityType,
    fop_name: snapshot.legalName,
    fop_tax_id: snapshot.taxId,
    fop_legal_address: snapshot.legalAddress,
    docs_email: snapshot.contactEmail ?? "",
    docs_phone: snapshot.contactPhone ?? "",
    short_name: snapshot.shortName ?? "",
    vat_number: snapshot.vatNumber ?? "",
    actual_address: snapshot.actualAddress ?? "",
    contact_name: snapshot.contactName ?? "",
    contact_email: snapshot.contactEmail ?? "",
    contact_phone: snapshot.contactPhone ?? "",
    iban: snapshot.iban ?? "",
    [LEGAL_ENTITY_TRANSPORT_ATTRIBUTE]: legalEntityTransport(snapshot),
  };
}

export function maskedTaxId(value: string) {
  const normalized = normalizeTaxId(value);
  if (normalized.length <= 4) return "*".repeat(normalized.length);
  return `${"*".repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

function stringOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}
