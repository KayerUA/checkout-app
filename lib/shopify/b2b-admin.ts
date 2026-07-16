import { getEnv } from "@/lib/env";
import { B2B_METAFIELD_NAMESPACE } from "@/lib/b2b/constants";

function getShopDomain(shopDomain?: string | null) {
  const env = getEnv();
  const domain = shopDomain || env.SHOPIFY_SHOP_DOMAIN;
  if (!domain) throw new Error("SHOPIFY_SHOP_DOMAIN is required");
  return domain;
}

function getAccessToken() {
  const token = getEnv().SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN is required for B2B Shopify updates");
  return token;
}

async function shopifyRest<T>(shopDomain: string | null | undefined, path: string, init: RequestInit = {}) {
  const env = getEnv();
  const domain = getShopDomain(shopDomain);
  const response = await fetch(`https://${domain}/admin/api/${env.SHOPIFY_API_VERSION}/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": getAccessToken(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Shopify Admin REST failed: ${await response.text()}`);
  return (await response.json()) as T;
}

async function shopifyGraphQL<T>(
  shopDomain: string | null | undefined,
  query: string,
  variables: Record<string, unknown>
) {
  const env = getEnv();
  const domain = getShopDomain(shopDomain);
  const response = await fetch(`https://${domain}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": getAccessToken(),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Shopify Admin GraphQL failed: ${await response.text()}`);
  return (await response.json()) as T;
}

function uniqueTags(tags?: string[]) {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)));
}

function orderGid(orderId: string) {
  return orderId.startsWith("gid://shopify/Order/") ? orderId : `gid://shopify/Order/${orderId}`;
}

function assertNoTagUserErrors(
  operation: "tagsAdd" | "tagsRemove",
  result: { data?: Record<string, { userErrors?: Array<{ message: string }> }> }
) {
  const errors = result.data?.[operation]?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`Shopify ${operation} failed: ${errors.map((error) => error.message).join("; ")}`);
  }
}

export async function updateOrderTags(input: {
  shopDomain?: string | null;
  orderId: string;
  add?: string[];
  remove?: string[];
}) {
  const id = orderGid(input.orderId);
  const add = uniqueTags(input.add);
  const remove = uniqueTags(input.remove);

  if (add.length) {
    const result = await shopifyGraphQL<{
      data?: { tagsAdd?: { userErrors: Array<{ message: string }> } };
    }>(
      input.shopDomain,
      `mutation TagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
      { id, tags: add }
    );
    assertNoTagUserErrors("tagsAdd", result);
  }

  if (remove.length) {
    const result = await shopifyGraphQL<{
      data?: { tagsRemove?: { userErrors: Array<{ message: string }> } };
    }>(
      input.shopDomain,
      `mutation TagsRemove($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
      { id, tags: remove }
    );
    assertNoTagUserErrors("tagsRemove", result);
  }
}

export async function setOrderMetafields(input: {
  shopDomain?: string | null;
  orderId: string;
  metafields: Record<string, string | number | boolean | null | undefined>;
}) {
  const existing = await shopifyRest<{ metafields: Array<{ id: number; key: string }> }>(
    input.shopDomain,
    `orders/${input.orderId}/metafields.json?namespace=${B2B_METAFIELD_NAMESPACE}`
  );
  const byKey = new Map(existing.metafields.map((field) => [field.key, field.id]));

  for (const [key, rawValue] of Object.entries(input.metafields)) {
    if (rawValue == null || rawValue === "") continue;
    const value = String(rawValue);
    const existingId = byKey.get(key);
    if (existingId) {
      await shopifyRest(input.shopDomain, `metafields/${existingId}.json`, {
        method: "PUT",
        body: JSON.stringify({
          metafield: { id: existingId, value, type: "single_line_text_field" },
        }),
      });
    } else {
      await shopifyRest(input.shopDomain, `orders/${input.orderId}/metafields.json`, {
        method: "POST",
        body: JSON.stringify({
          metafield: {
            namespace: B2B_METAFIELD_NAMESPACE,
            key,
            value,
            type: "single_line_text_field",
          },
        }),
      });
    }
  }
}

export async function appendOrderNote(input: {
  shopDomain?: string | null;
  orderId: string;
  marker: string;
  message: string;
}) {
  const id = orderGid(input.orderId);
  const currentResult = await shopifyGraphQL<{
    data?: { order?: { note?: string | null } | null };
    errors?: Array<{ message: string }>;
  }>(
    input.shopDomain,
    `query OrderNote($id: ID!) {
      order(id: $id) { note }
    }`,
    { id }
  );
  if (currentResult.errors?.length) {
    throw new Error(
      `Shopify order note query failed: ${currentResult.errors.map((error) => error.message).join("; ")}`
    );
  }
  const currentNote = currentResult.data?.order?.note?.trim() ?? "";
  if (currentNote.includes(input.marker)) return { updated: false };

  const note = [currentNote, input.message].filter(Boolean).join("\n\n");
  const updateResult = await shopifyGraphQL<{
    data?: {
      orderUpdate?: {
        order?: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  }>(
    input.shopDomain,
    `mutation UpdateOrderNote($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id }
        userErrors { message }
      }
    }`,
    { input: { id, note } }
  );
  if (updateResult.errors?.length) {
    throw new Error(
      `Shopify order note update failed: ${updateResult.errors.map((error) => error.message).join("; ")}`
    );
  }
  const userErrors = updateResult.data?.orderUpdate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      `Shopify order note update failed: ${userErrors.map((error) => error.message).join("; ")}`
    );
  }
  return { updated: true };
}

export async function sendOrderInvoiceEmail(input: {
  shopDomain?: string | null;
  orderId: string;
  to: string;
  subject: string;
  customMessage: string;
}) {
  const result = await shopifyGraphQL<{
    data?: {
      orderInvoiceSend?: {
        order?: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    };
  }>(
    input.shopDomain,
    `mutation OrderInvoiceSend($orderId: ID!, $email: EmailInput) {
      orderInvoiceSend(id: $orderId, email: $email) {
        order { id }
        userErrors { message }
      }
    }`,
    {
      orderId: orderGid(input.orderId),
      email: {
        to: input.to,
        subject: input.subject,
        customMessage: input.customMessage,
      },
    }
  );

  const errors = result.data?.orderInvoiceSend?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`Shopify order invoice email failed: ${errors.map((error) => error.message).join("; ")}`);
  }

  return result.data?.orderInvoiceSend?.order ?? null;
}

export async function getShopifyOrder(input: { shopDomain?: string | null; orderId: string }) {
  const result = await shopifyRest<{ order: unknown }>(
    input.shopDomain,
    `orders/${input.orderId}.json`
  );
  return result.order;
}

type ShopifyOrderTransaction = {
  id: number | string;
  kind?: string | null;
  status?: string | null;
  amount?: string | null;
  currency?: string | null;
  gateway?: string | null;
  authorization?: string | null;
  receipt?: Record<string, unknown> | null;
};

function isBankTransferTransaction(
  transaction: ShopifyOrderTransaction,
  bankTransactionId: string
) {
  return (
    transaction.authorization === bankTransactionId ||
    transaction.receipt?.bank_transaction_id === bankTransactionId
  );
}

function isSuccessfulPaymentTransaction(transaction: ShopifyOrderTransaction) {
  const kind = transaction.kind?.toLowerCase();
  const status = transaction.status?.toLowerCase();
  return (kind === "sale" || kind === "capture") && status === "success";
}

function latestSuccessfulPaymentTransaction(transactions: ShopifyOrderTransaction[]) {
  return [...transactions].reverse().find(isSuccessfulPaymentTransaction);
}

function successfulPaymentAmount(transactions: ShopifyOrderTransaction[]) {
  return transactions.reduce((total, transaction) => {
    if (!isSuccessfulPaymentTransaction(transaction)) return total;
    const amount = Number(transaction.amount);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function paymentResult(
  transactions: ShopifyOrderTransaction[],
  transaction: ShopifyOrderTransaction,
  created: boolean
) {
  return {
    transaction,
    created,
    recordedAmount: Math.round(successfulPaymentAmount(transactions) * 100) / 100,
  };
}

type OrderMarkAsPaidResponse = {
  data?: {
    order?: {
      id: string;
      name: string;
      canMarkAsPaid: boolean;
      displayFinancialStatus: string;
      totalOutstandingSet?: {
        shopMoney?: {
          amount: string;
          currencyCode: string;
        };
      };
    } | null;
    orderMarkAsPaid?: {
      userErrors: Array<{ field?: string[] | null; message: string }>;
      order: {
        id: string;
        name: string;
        canMarkAsPaid: boolean;
        displayFinancialStatus: string;
      } | null;
    };
  };
  errors?: Array<{ message: string }>;
};

async function getOrderPaymentState(shopDomain: string | null | undefined, orderId: string) {
  const result = await shopifyGraphQL<OrderMarkAsPaidResponse>(
    shopDomain,
    `query OrderPaymentState($id: ID!) {
      order(id: $id) {
        id
        name
        canMarkAsPaid
        displayFinancialStatus
        totalOutstandingSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
    }`,
    { id: orderGid(orderId) }
  );
  if (result.errors?.length) {
    throw new Error(`Shopify order payment state failed: ${result.errors.map((error) => error.message).join("; ")}`);
  }
  const order = result.data?.order;
  if (!order) throw new Error(`Shopify order ${orderId} not found`);
  return order;
}

async function orderMarkAsPaid(shopDomain: string | null | undefined, orderId: string) {
  const result = await shopifyGraphQL<OrderMarkAsPaidResponse>(
    shopDomain,
    `mutation MarkOrderAsPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) {
        userErrors {
          field
          message
        }
        order {
          id
          name
          canMarkAsPaid
          displayFinancialStatus
        }
      }
    }`,
    { input: { id: orderGid(orderId) } }
  );
  if (result.errors?.length) {
    throw new Error(`Shopify orderMarkAsPaid failed: ${result.errors.map((error) => error.message).join("; ")}`);
  }
  const payload = result.data?.orderMarkAsPaid;
  if (!payload) throw new Error("Shopify orderMarkAsPaid returned an empty response");
  if (payload.userErrors.length) {
    throw new Error(`Shopify orderMarkAsPaid failed: ${payload.userErrors.map((error) => error.message).join("; ")}`);
  }
  return payload.order;
}

export async function markOrderPaidByBankTransfer(input: {
  shopDomain?: string | null;
  orderId: string;
  amount: number;
  currency: string;
  bankTransactionId: string;
}) {
  const transactions = await shopifyRest<{ transactions: ShopifyOrderTransaction[] }>(
    input.shopDomain,
    `orders/${input.orderId}/transactions.json`
  );
  const existing = transactions.transactions.find((transaction) =>
    isBankTransferTransaction(transaction, input.bankTransactionId)
  );
  if (existing) {
    return paymentResult(transactions.transactions, existing, false);
  }

  const state = await getOrderPaymentState(input.shopDomain, input.orderId);
  if (!state.canMarkAsPaid) {
    const paidTransaction = latestSuccessfulPaymentTransaction(transactions.transactions);
    if (paidTransaction) {
      return paymentResult(transactions.transactions, paidTransaction, false);
    }
    throw new Error(`Shopify order ${state.name} cannot be marked as paid (${state.displayFinancialStatus})`);
  }

  await orderMarkAsPaid(input.shopDomain, input.orderId);

  const updated = await shopifyRest<{ transactions: ShopifyOrderTransaction[] }>(
    input.shopDomain,
    `orders/${input.orderId}/transactions.json`
  );
  const paidTransaction = latestSuccessfulPaymentTransaction(updated.transactions);
  if (!paidTransaction) throw new Error("Shopify marked order as paid but no successful payment transaction was returned");

  return paymentResult(updated.transactions, paidTransaction, true);
}
