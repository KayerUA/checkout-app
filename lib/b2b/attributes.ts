import { z } from "zod";
import type { FopOrderAttributes, ShopifyOrderPayload } from "@/lib/b2b/types";

const b2bAttributeSchema = z.object({
  buyer_type: z.enum(["individual", "fop_company"]).default("individual"),
  payment_preference: z.enum(["card", "bank_invoice"]).default("card"),
  fop_name: z.string().trim().max(200).optional().or(z.literal("")),
  fop_tax_id: z.string().trim().max(20).optional().or(z.literal("")),
  fop_legal_address: z.string().trim().max(500).optional().or(z.literal("")),
  docs_email: z.string().trim().email().optional().or(z.literal("")),
  docs_phone: z.string().trim().max(40).optional().or(z.literal("")),
  accounting_comment: z.string().trim().max(1000).optional().or(z.literal("")),
});

export function normalizeB2BAttributes(input: Record<string, unknown>): FopOrderAttributes {
  const parsed = b2bAttributeSchema.parse(input);
  return {
    buyer_type: parsed.buyer_type,
    payment_preference: parsed.payment_preference,
    fop_name: parsed.fop_name || undefined,
    fop_tax_id: parsed.fop_tax_id || undefined,
    fop_legal_address: parsed.fop_legal_address || undefined,
    docs_email: parsed.docs_email || undefined,
    docs_phone: parsed.docs_phone || undefined,
    accounting_comment: parsed.accounting_comment || undefined,
  };
}

export function getOrderAttributes(order: ShopifyOrderPayload): Record<string, string> {
  const entries = [...(order.note_attributes ?? []), ...(order.customAttributes ?? [])];
  return entries.reduce<Record<string, string>>((acc, attr) => {
    const key = attr.name ?? attr.key;
    if (!key) return acc;
    acc[key] = attr.value == null ? "" : String(attr.value);
    return acc;
  }, {});
}

export function getB2BAttributesFromOrder(order: ShopifyOrderPayload): FopOrderAttributes {
  return normalizeB2BAttributes(getOrderAttributes(order));
}

export function validateFopFields(attrs: FopOrderAttributes) {
  if (attrs.buyer_type !== "fop_company") return;
  const taxId = (attrs.fop_tax_id ?? "").replace(/\D/g, "");
  const docsPhone = (attrs.docs_phone ?? "").replace(/\D/g, "");
  const missing = [
    ["fop_name", attrs.fop_name],
    ["fop_tax_id", taxId],
    ["docs_email", attrs.docs_email],
    ["docs_phone", docsPhone],
    ["fop_legal_address", attrs.fop_legal_address],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing company billing fields: ${missing.map(([key]) => key).join(", ")}`);
  }

  if (![8, 10].includes(taxId.length)) {
    throw new Error("ЄДРПОУ must contain 8 digits, ІПН/РНОКПП must contain 10 digits");
  }

  if ((attrs.fop_name ?? "").trim().length < 3) {
    throw new Error("Company billing name is too short");
  }

  if (docsPhone.length < 10) {
    throw new Error("Documents phone is invalid");
  }

  if ((attrs.fop_legal_address ?? "").trim().length < 8) {
    throw new Error("Legal address is too short");
  }
}
