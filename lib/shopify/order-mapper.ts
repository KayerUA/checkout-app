import type { CheckoutSession, CheckoutLine, PaymentAttempt } from "@prisma/client";

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

type SessionWithRelations = CheckoutSession & {
  lines: CheckoutLine[];
  paymentAttempts: PaymentAttempt[];
};

export function mapCheckoutToOrderCreateInput(
  session: SessionWithRelations,
  paidAttempt: PaymentAttempt | null,
  options?: { financialStatus?: "PAID" | "PENDING"; sourceName?: string }
) {
  const shippingPayload = (session.shippingPayload ?? {}) as Record<string, string>;
  const sessionAttrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const ab = (sessionAttrs.ab ?? {}) as Record<string, string>;

  const customAttributes = [
    { key: "checkout_session_id", value: session.id },
    { key: "payment_provider", value: paidAttempt?.provider ?? "BANK_INVOICE" },
    { key: "checkout_public_token", value: session.publicToken },
    { key: "source_identifier", value: session.sourceIdentifier ?? session.id },
  ];

  [
    "buyer_type",
    "payment_preference",
    "fop_name",
    "fop_tax_id",
    "fop_legal_address",
    "docs_email",
    "docs_phone",
    "accounting_comment",
  ].forEach((key) => {
    const value = sessionAttrs[key];
    if (typeof value === "string" && value) customAttributes.push({ key, value });
  });

  if (ab.experimentId) {
    customAttributes.push(
      { key: "ab_test", value: ab.experimentId },
      { key: "ab_variant", value: ab.variant ?? "" },
      { key: "ab_visitor_id", value: ab.visitorId ?? "" }
    );
  }

  if (shippingPayload.branchRef) {
    customAttributes.push(
      { key: "np_branch_ref", value: shippingPayload.branchRef },
      { key: "np_branch_name", value: shippingPayload.branchName ?? "" }
    );
  }

  return {
    currency: session.currency,
    email: session.buyerEmail ?? undefined,
    phone: session.buyerPhone ?? undefined,
    financialStatus: options?.financialStatus ?? "PAID",
    sourceIdentifier: session.sourceIdentifier ?? session.id,
    sourceName: options?.sourceName ?? "ua_external_checkout",
    note:
      sessionAttrs.buyer_type === "fop_company"
        ? "UA external checkout B2B/FOP order"
        : "UA external checkout order",
    customAttributes,
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
      ...(ab.experimentId
        ? [
            `ab_${ab.experimentId}`,
            ab.variant === "kayer_custom_v1" ? "ab_variant_custom" : "ab_variant_chekly",
            ...(ab.variant === "kayer_custom_v1" ? ["checkout_custom_v1"] : []),
          ]
        : []),
    ],
    lineItems: session.lines.map((line) => ({
      variantId: line.variantGid,
      quantity: line.quantity,
      priceSet: {
        shopMoney: {
          amount: line.unitPrice / 100,
          currencyCode: session.currency,
        },
      },
      sku: line.sku ?? undefined,
      title: line.title,
    })),
    shippingAddress: {
      firstName: session.buyerFirstName ?? "",
      lastName: session.buyerLastName ?? "",
      address1: shippingPayload.branchName ?? shippingPayload.address ?? "",
      city: shippingPayload.cityName ?? "Kyiv",
      countryCode: "UA",
      zip: shippingPayload.postalCode ?? "01001",
    },
    shippingLines: session.shippingAmount
      ? [
          {
            title: session.shippingMethodCode ?? "Nova Poshta",
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
