import { z } from "zod";

const shortText = z.string().trim().max(160);
const nullableShortText = shortText.nullable();
const moneyCents = z.number().int().nonnegative().max(100_000_000);
export const requiredCheckoutEmailSchema = z.string().trim().email().max(254);

const email = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || requiredCheckoutEmailSchema.safeParse(value).success, {
    message: "Invalid email",
  })
  .nullable();

export const checkoutShippingPayloadSchema = z
  .object({
    cityRef: nullableShortText.optional(),
    cityName: nullableShortText.optional(),
    branchRef: nullableShortText.optional(),
    branchName: z.string().trim().max(500).nullable().optional(),
    branchNumber: nullableShortText.optional(),
    branchType: nullableShortText.optional(),
    postalCode: nullableShortText.optional(),
    address: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.branchRef && !/^\d{5}$/.test(payload.postalCode ?? "")) {
      context.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "Nova Poshta branch postal code is required",
      });
    }
  });

export const editableCheckoutAttributesSchema = z
  .object({
    buyer_type: z.enum(["individual", "fop_company"]).nullable().optional(),
    payment_preference: z.enum(["card", "bank_invoice"]).nullable().optional(),
    fop_name: nullableShortText.optional(),
    fop_tax_id: z.string().trim().max(20).nullable().optional(),
    fop_legal_address: z.string().trim().max(500).nullable().optional(),
    docs_email: email.optional(),
    docs_phone: z.string().trim().max(32).nullable().optional(),
    accounting_comment: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const checkoutSessionPatchSchema = z
  .object({
    buyerEmail: email.optional(),
    buyerPhone: z.string().trim().max(32).nullable().optional(),
    buyerFirstName: nullableShortText.optional(),
    buyerLastName: nullableShortText.optional(),
    shippingMethodCode: z.enum(["nova_poshta_branch", "nova_poshta_locker"]).optional(),
    shippingProvider: z.literal("nova_poshta").optional(),
    shippingPayload: checkoutShippingPayloadSchema.optional(),
    paymentProvider: z.enum(["LIQPAY", "BANK_INVOICE"]).optional(),
    customAttributes: editableCheckoutAttributesSchema.optional(),
    status: z.literal("READY").optional(),
  })
  .strict();

const cartDiscountSnapshotSchema = z
  .object({
    grossSubtotalCents: moneyCents,
    discountRows: z
      .array(
        z
          .object({
            title: z.string().trim().max(160),
            amountCents: moneyCents,
          })
          .strict()
      )
      .max(20),
    totalDueCents: moneyCents,
    pricingMode: z.enum(["shopify_cart", "partner_rules"]),
  })
  .strict();

const checkoutCreateAttributesSchema = editableCheckoutAttributesSchema.extend({
  // The Shopify storefront bridge includes these legacy contact attributes on
  // every checkout request, including for anonymous customers as empty strings.
  customer_email: email.optional(),
  customer_first_name: nullableShortText.optional(),
  customer_last_name: nullableShortText.optional(),
  customer_phone: z.string().trim().max(32).nullable().optional(),
  cartDiscountSnapshot: cartDiscountSnapshotSchema.optional(),
  appliedDiscountCode: z.string().trim().min(1).max(64).optional(),
});

export const publicCheckoutSessionCreateSchema = z
  .object({
    merchantId: z.string().trim().max(80).optional(),
    shopDomain: z.string().trim().max(255).optional(),
    cartLines: z
      .array(
        z
          .object({
            variantGid: z.string().trim().min(1).max(255),
            quantity: z.number().int().positive().max(100),
            unitPriceCents: moneyCents.optional(),
            originalUnitPriceCents: moneyCents.optional(),
          })
          .strict()
      )
      .min(1)
      .max(100),
    storefrontCustomerEmail: z.string().trim().email().max(254).optional(),
    storefrontCustomerId: z.preprocess(
      (value) => (value == null || value === "" ? undefined : String(value)),
      z.string().trim().max(80).optional()
    ),
    storefrontCustomerFirstName: shortText.optional(),
    storefrontCustomerLastName: shortText.optional(),
    storefrontCustomerPhone: z.string().trim().max(32).optional(),
    storefrontPricingToken: z.preprocess(
      (value) => (value == null || value === "" ? undefined : value),
      z.string().min(10).max(4096).optional()
    ),
    cartToken: z.string().trim().max(255).optional(),
    cartItemsSubtotalCents: moneyCents.optional(),
    cartTotalCents: moneyCents.optional(),
    utm: z
      .record(z.string().max(64), z.string().max(500))
      .refine((value) => Object.keys(value).length <= 10, "Too many UTM fields")
      .optional(),
    sourceUrl: z.string().url().max(2048).optional(),
    customAttributes: checkoutCreateAttributesSchema.optional(),
  })
  .strict();

export type CheckoutSessionPatch = z.infer<typeof checkoutSessionPatchSchema>;
