import type { CheckoutSession, CheckoutLine, PaymentAttempt } from "@prisma/client";
import {
  buildShopifyNovaPoshtaNoteAttributes,
  type NovaPoshtaShippingPayload,
} from "@/lib/shipping/shopify-np-note-attributes";
import { isPartnerProgramDiscountCode } from "@/lib/checkout/partner-pricing";
import { normalizePhoneForShopify } from "@/lib/checkout/phone";
import { normalizeUaPersonName } from "@/lib/checkout/ua-person-name";
import {
  LEGAL_ENTITY_TRANSPORT_ATTRIBUTE,
  legalEntitySnapshotSchema,
  legalEntityTransport,
  legalEntityV2Enabled,
} from "@/lib/legal-entities/model";

const ORDER_CREATE_MUTATION = `
  mutation OrderCreateExternal($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      userErrors { field message }
      order {
        id
        name
        displayFinancialStatus
        tags
        customAttributes { key value }
      }
    }
  }
`;

export const DELIVERY_ADDRESS_TRANSPORT_ATTRIBUTE = "delivery_address_v1";

type SessionWithRelations = Omit<
  CheckoutSession,
  "shopifyCustomerGid" | "legalEntityId" | "legalEntitySnapshot"
> &
  Partial<
    Pick<CheckoutSession, "shopifyCustomerGid" | "legalEntityId" | "legalEntitySnapshot">
  > & {
  lines: CheckoutLine[];
  paymentAttempts: PaymentAttempt[];
};

export function allocateProportionalDiscountCents(bases: number[], requestedDiscount: number) {
  const normalized = bases.map((base) => Math.max(0, Math.round(base)));
  const subtotal = normalized.reduce((sum, base) => sum + base, 0);
  const target = Math.min(subtotal, Math.max(0, Math.round(requestedDiscount)));
  if (subtotal <= 0 || target <= 0) return normalized.map(() => 0);

  const raw = normalized.map((base) => (base * target) / subtotal);
  const allocated = raw.map((amount) => Math.floor(amount));
  let remainder = target - allocated.reduce((sum, amount) => sum + amount, 0);

  const order = raw
    .map((amount, index) => ({ index, fraction: amount - allocated[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (const row of order) {
    if (remainder <= 0) break;
    if (allocated[row.index] >= normalized[row.index]) continue;
    allocated[row.index] += 1;
    remainder -= 1;
  }

  return allocated;
}

export function mapCheckoutToOrderCreateInput(
  session: SessionWithRelations,
  paidAttempt: PaymentAttempt | null,
  options?: {
    financialStatus?: "PAID" | "PENDING";
    sourceName?: string;
    includeShippingLines?: boolean;
    /**
     * Keep the order as a guest checkout when Shopify cannot safely upsert a
     * customer (for example, when its phone belongs to a different account).
     */
    includeCustomer?: boolean;
    /**
     * Omit Shopify's validated phone fields on a retry after Shopify rejects
     * the phone. The contact phone remains in the checkout snapshot and custom
     * attributes used by fulfillment and accounting.
     */
    includePhone?: boolean;
  }
) {
  const shippingPayload = (session.shippingPayload ?? {}) as NovaPoshtaShippingPayload;
  const sessionAttrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const shippingLineTitle = session.shippingMethodCode?.startsWith("nova_poshta")
    ? "Нова Пошта"
    : session.shippingMethodCode ?? "Нова Пошта";

  const customAttributes = [
    { key: "checkout_session_id", value: session.id },
    { key: "payment_provider", value: paidAttempt?.provider ?? "BANK_INVOICE" },
    { key: "checkout_public_token", value: session.publicToken },
    { key: "source_identifier", value: session.sourceIdentifier ?? session.id },
  ];
  const deliveryAddressSnapshot = {
    version: 1,
    recipient: {
      firstName: session.buyerFirstName?.trim() ?? "",
      lastName: session.buyerLastName?.trim() ?? "",
      phone: session.buyerPhone?.trim() ?? "",
    },
    delivery: {
      methodCode: session.shippingMethodCode ?? "",
      provider: session.shippingProvider ?? "",
      address1: shippingPayload.branchName ?? shippingPayload.address ?? "",
      address2: "",
      city: shippingPayload.cityName ?? "",
      province: "",
      zip: shippingPayload.postalCode ?? "",
      countryCode: "UA",
    },
  };
  customAttributes.push({
    key: DELIVERY_ADDRESS_TRANSPORT_ATTRIBUTE,
    value: JSON.stringify(deliveryAddressSnapshot),
  });

  [
    "buyer_type",
    "payment_preference",
    "fop_name",
    "fop_tax_id",
    "fop_legal_address",
    "docs_email",
    "docs_phone",
    "accounting_comment",
    "partnerMarket",
    "pricingMode",
    "entity_type",
    "short_name",
    "vat_number",
    "actual_address",
    "contact_name",
    "contact_email",
    "contact_phone",
    "iban",
  ].forEach((key) => {
    const value = sessionAttrs[key];
    if (typeof value === "string" && value) customAttributes.push({ key, value });
  });

  if (legalEntityV2Enabled()) {
    const snapshot = legalEntitySnapshotSchema.safeParse(session.legalEntitySnapshot);
    if (snapshot.success) {
      customAttributes.push({
        key: LEGAL_ENTITY_TRANSPORT_ATTRIBUTE,
        value: legalEntityTransport(snapshot.data),
      });
      if (session.legalEntityId) {
        customAttributes.push({ key: "legal_entity_id", value: session.legalEntityId });
      }
    }
  }

  for (const row of buildShopifyNovaPoshtaNoteAttributes(shippingPayload)) {
    customAttributes.push({ key: row.name, value: row.value });
  }

  const appliedDiscountCode =
    typeof sessionAttrs.appliedDiscountCode === "string"
      ? sessionAttrs.appliedDiscountCode.trim()
      : "";
  // Partner % is in line unit prices — never write PARTNER-* onto Shopify orders.
  const effectiveDiscountCode = isPartnerProgramDiscountCode(appliedDiscountCode)
    ? ""
    : appliedDiscountCode;
  if (effectiveDiscountCode) {
    customAttributes.push({ key: "discount_code", value: effectiveDiscountCode });
  }

  const lineBases = session.lines.map((line) =>
    Math.max(0, line.unitPrice * line.quantity - line.lineDiscountAmount)
  );
  const sessionCartDiscount = Math.max(0, session.discountAmount ?? 0);
  const hasExplicitDiscountCode = effectiveDiscountCode !== "";
  // Loyalty (ORDER-class automatic) goes into unit prices, exactly as for a cart without
  // a code. Only the promo part becomes a Shopify discount code — orderCreate takes one.
  const loyaltyDiscount = Math.min(
    sessionCartDiscount,
    Math.max(
      0,
      Math.round(
        typeof sessionAttrs.loyaltyDiscountCents === "number"
          ? sessionAttrs.loyaltyDiscountCents
          : 0
      )
    )
  );
  const promoDiscount = hasExplicitDiscountCode
    ? Math.max(0, sessionCartDiscount - loyaltyDiscount)
    : 0;
  const foldedDiscounts = allocateProportionalDiscountCents(
    lineBases,
    hasExplicitDiscountCode ? loyaltyDiscount : sessionCartDiscount
  );
  const buyerEmail = session.buyerEmail?.trim() || undefined;
  const buyerPhone = normalizePhoneForShopify(session.buyerPhone);
  const shopifyPhone = options?.includePhone === false ? undefined : buyerPhone;
  const buyerFirstName =
    normalizeUaPersonName(session.buyerFirstName?.trim() || undefined) || undefined;
  const buyerLastName =
    normalizeUaPersonName(session.buyerLastName?.trim() || undefined) || undefined;

  return {
    currency: session.currency,
    email: buyerEmail,
    ...(shopifyPhone ? { phone: shopifyPhone } : {}),
    ...(options?.includeCustomer !== false && (buyerEmail || shopifyPhone)
      ? {
          customer: {
            toUpsert: {
              email: buyerEmail,
              ...(shopifyPhone ? { phone: shopifyPhone } : {}),
              firstName: buyerFirstName,
              lastName: buyerLastName,
            },
          },
        }
      : {}),
    financialStatus: options?.financialStatus ?? "PAID",
    sourceIdentifier: session.sourceIdentifier ?? session.id,
    sourceName: options?.sourceName ?? "ua_external_checkout",
    note:
      sessionAttrs.buyer_type === "fop_company"
        ? "UA external checkout B2B/ФОП order"
        : "UA external checkout order",
    customAttributes,
    ...(hasExplicitDiscountCode && promoDiscount > 0
      ? {
          discountCode: {
            itemFixedDiscountCode: {
              code: effectiveDiscountCode,
              amountSet: {
                shopMoney: {
                  amount: promoDiscount / 100,
                  currencyCode: session.currency,
                },
              },
            },
          },
        }
      : {}),
    metafields: [
      {
        namespace: "external_checkout",
        key: "shipping_payload",
        type: "json",
        value: JSON.stringify(session.shippingPayload ?? {}),
      },
      {
        namespace: "external_checkout",
        key: "payment_payload",
        type: "json",
        value: JSON.stringify({
          provider: paidAttempt?.provider ?? "BANK_INVOICE",
          reference: paidAttempt?.providerReference,
          payment_preference: sessionAttrs.payment_preference,
        }),
      },
    ],
    tags: [
      "external_checkout",
      "ua",
      (paidAttempt?.provider ?? "BANK_INVOICE").toLowerCase(),
      session.shippingProvider ?? "shipping",
      ...(sessionAttrs.buyer_type === "fop_company" ? ["B2B_FOP"] : []),
      ...(sessionAttrs.payment_preference === "bank_invoice" ? ["WAITING_IBAN_PAYMENT"] : []),
    ],
    lineItems: session.lines.map((line, index) => {
      const lineBase = lineBases[index];
      const lineTotal = Math.max(0, lineBase - foldedDiscounts[index]);
      const effectiveUnit = line.quantity > 0 ? lineTotal / line.quantity : line.unitPrice;
      return {
      variantId: line.variantGid,
      quantity: line.quantity,
      priceSet: {
        shopMoney: {
          amount: effectiveUnit / 100,
          currencyCode: session.currency,
        },
      },
      sku: line.sku ?? undefined,
      title: line.title,
    };
    }),
    shippingAddress: {
      firstName: buyerFirstName ?? "",
      lastName: buyerLastName ?? "",
      ...(shopifyPhone ? { phone: shopifyPhone } : {}),
      address1: shippingPayload.branchName ?? shippingPayload.address ?? "",
      city: shippingPayload.cityName ?? "",
      countryCode: "UA",
      zip: shippingPayload.postalCode ?? undefined,
    },
    shippingLines: options?.includeShippingLines === true
      ? [
          {
            title: shippingLineTitle,
            priceSet: {
              shopMoney: {
                amount: session.shippingAmount / 100,
                currencyCode: session.currency,
              },
            },
          },
        ]
      : [],
  };
}

export { ORDER_CREATE_MUTATION };
