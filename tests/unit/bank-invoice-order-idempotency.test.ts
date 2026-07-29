import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  link: null as null | Record<string, unknown>,
  mutationCalls: 0,
  rejectPhoneOnce: false,
}));

const session = {
  id: "session-1",
  publicToken: "token-1",
  merchantId: "merchant-1",
  sourceIdentifier: "source-1",
  customAttributes: { buyer_type: "fop_company", payment_preference: "bank_invoice" },
  shippingPayload: {
    cityRef: "city-1",
    cityName: "Київ",
    branchRef: "branch-1",
    branchName: "Відділення №1",
    postalCode: "01001",
  },
  buyerEmail: "buyer@example.com",
  buyerPhone: "+380671234567",
  buyerFirstName: "Ірина",
  buyerLastName: "Коваль",
  shippingProvider: "nova_poshta",
  shippingMethodCode: "nova_poshta_branch",
  lines: [],
  paymentAttempts: [],
  merchant: { id: "merchant-1" },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    checkoutSession: {
      findUnique: vi.fn(async () =>
        state.link?.shopifyOrderGid
          ? { ...session, status: "COMPLETED", orderLink: state.link }
          : { ...session, status: "READY", orderLink: null }
      ),
      findUniqueOrThrow: vi.fn(async () => session),
      update: vi.fn(async () => session),
    },
    orderLink: {
      create: vi.fn(async () => {
        if (state.link) throw new Error("unique constraint");
        state.link = {
          id: "order-link-1",
          checkoutSessionId: session.id,
          shopifyOrderGid: null,
          shopifyOrderName: null,
          sourceIdentifier: session.sourceIdentifier,
          orderStatus: "CREATING",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return state.link;
      }),
      findUnique: vi.fn(async () => state.link),
      findUniqueOrThrow: vi.fn(async () => state.link),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.link = { ...state.link, ...data, updatedAt: new Date() };
        return state.link;
      }),
    },
  },
}));

vi.mock("@/lib/checkout/session-service", () => ({
  repriceCheckoutSession: vi.fn(async () => session),
}));
vi.mock("@/lib/shopify/session-store", () => ({
  getMerchantShopifySession: vi.fn(async () => ({ shop: "kayer.myshopify.com" })),
}));
vi.mock("@/lib/shopify/admin", () => ({
  shopifyAdminREST: vi.fn(),
  shopifyAdminGraphQL: vi.fn(async (_session: unknown, query: string) => {
    if (query.includes("FindExistingExternalCheckoutOrder")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: { orders: { nodes: [] } } };
    }
    state.mutationCalls += 1;
    if (state.rejectPhoneOnce && state.mutationCalls === 1) {
      return {
        data: {
          orderCreate: {
            userErrors: [{ field: ["order", "phone"], message: "Phone is invalid" }],
            order: null,
          },
        },
      };
    }
    return { data: { orderCreate: { userErrors: [], order: { id: "gid://shopify/Order/1", name: "#1001" } } } };
  }),
}));
vi.mock("@/lib/shopify/order-mapper", () => ({
  ORDER_CREATE_MUTATION: "mutation OrderCreateExternal",
  mapCheckoutToOrderCreateInput: vi.fn(() => ({})),
}));
vi.mock("@/lib/queue", () => ({ QUEUE_NAMES: {}, enqueueJob: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logWithCorrelation: vi.fn() }));
vi.mock("@/lib/b2b/attributes", () => ({
  normalizeB2BAttributes: vi.fn((value) => value),
  validateFopFields: vi.fn(),
}));
vi.mock("@/lib/shipping/shopify-np-note-attributes", () => ({
  mergeCheckoutNoteAttributes: vi.fn((attributes) => attributes),
}));

import { createBankInvoiceShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { mapCheckoutToOrderCreateInput } from "@/lib/shopify/order-mapper";
import { repriceCheckoutSession } from "@/lib/checkout/session-service";

describe("bank invoice Shopify order creation", () => {
  beforeEach(() => {
    state.link = null;
    state.mutationCalls = 0;
    state.rejectPhoneOnce = false;
    vi.mocked(mapCheckoutToOrderCreateInput).mockClear();
    vi.mocked(repriceCheckoutSession).mockClear();
  });

  it("issues one Shopify orderCreate for concurrent checkout requests", async () => {
    const results = await Promise.allSettled([
      createBankInvoiceShopifyOrderIdempotent(session.publicToken),
      createBankInvoiceShopifyOrderIdempotent(session.publicToken),
    ]);

    expect(state.mutationCalls).toBe(1);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  });

  it("retries a rejected Shopify phone once without phone fields", async () => {
    state.rejectPhoneOnce = true;

    await expect(
      createBankInvoiceShopifyOrderIdempotent(session.publicToken),
    ).resolves.toMatchObject({
      shopifyOrderGid: "gid://shopify/Order/1",
    });

    expect(state.mutationCalls).toBe(2);
    expect(mapCheckoutToOrderCreateInput).toHaveBeenNthCalledWith(
      2,
      session,
      null,
      expect.objectContaining({
        includeCustomer: false,
        includePhone: false,
      }),
    );
  });

  it("does not reprice a completed checkout when recovering its invoice", async () => {
    state.link = {
      id: "order-link-1",
      checkoutSessionId: session.id,
      shopifyOrderGid: "gid://shopify/Order/1",
      shopifyOrderName: "#1001",
      sourceIdentifier: session.sourceIdentifier,
      orderStatus: "WAITING_BANK_PAYMENT",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await expect(
      createBankInvoiceShopifyOrderIdempotent(session.publicToken),
    ).resolves.toMatchObject({
      shopifyOrderGid: "gid://shopify/Order/1",
    });

    expect(repriceCheckoutSession).not.toHaveBeenCalled();
    expect(state.mutationCalls).toBe(0);
  });
});
