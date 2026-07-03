import { prisma } from "@/lib/db";
import { getPaymentAdapter } from "@/lib/payments/index";
import { getLiqPayCallbackUrl } from "@/lib/payments/liqpay";
import { getMonobankCallbackUrl } from "@/lib/payments/monobank";
import { parseLiqPayData } from "@/lib/payments/types";
import { getEnv } from "@/lib/env";
import { enqueueJob, QUEUE_NAMES } from "@/lib/queue";
import { logWithCorrelation } from "@/lib/logger";
import type { PaymentProvider, PaymentStatus, Prisma } from "@prisma/client";

function getCallbackUrl(provider: PaymentProvider) {
  if (provider === "LIQPAY") return getLiqPayCallbackUrl();
  if (provider === "MONOBANK") return getMonobankCallbackUrl();
  return `${getEnv().APP_URL}/api/callbacks/${provider.toLowerCase()}`;
}

function extractUnverifiedProviderReference(
  provider: PaymentProvider,
  rawBody: string | Buffer
): string | null {
  try {
    const bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    if (provider === "LIQPAY") {
      const data = typeof body.data === "string" ? body.data : null;
      if (!data) return null;
      const parsed = parseLiqPayData(data) as Record<string, unknown>;
      return typeof parsed.order_id === "string" ? parsed.order_id : null;
    }

    if (provider === "MONOBANK") {
      const invoiceId = body.invoiceId ?? body.invoice_id;
      return typeof invoiceId === "string" ? invoiceId : null;
    }
  } catch {
    return null;
  }

  return null;
}

async function ensureShopifyOrderCreation(checkoutSessionId: string) {
  const { createShopifyOrderIdempotent } = await import("@/lib/shopify/order-writer");

  try {
    await createShopifyOrderIdempotent(checkoutSessionId);
    return;
  } catch (error) {
    logWithCorrelation(
      "warn",
      "Inline Shopify order creation failed, enqueueing retry",
      { checkoutSessionId },
      { error: error instanceof Error ? error.message : String(error) }
    );
  }

  try {
    await enqueueJob(QUEUE_NAMES.ORDERS, "create-shopify-order", {
      checkoutSessionId,
    });
  } catch (error) {
    logWithCorrelation(
      "error",
      "Order queue retry unavailable",
      { checkoutSessionId },
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function initPaymentForSession(publicToken: string, provider: PaymentProvider) {
  const session = await prisma.checkoutSession.findUnique({
    where: { publicToken },
    include: { merchant: { include: { paymentConfigs: true } } },
  });
  if (!session) throw new Error("Session not found");
  if (session.totalAmount <= 0) throw new Error("Invalid amount");

  const config = session.merchant.paymentConfigs.find(
    (c) => c.provider === provider && c.isEnabled
  );
  if (!config) throw new Error(`Payment provider ${provider} not configured`);

  const adapter = getPaymentAdapter(provider);
  const orderReference = `${session.sourceIdentifier}_${Date.now()}`;
  const returnUrl = `${getEnv().APP_URL}/checkout/${publicToken}/thank-you`;
  const callbackUrl = getCallbackUrl(provider);

  const result = await adapter.initPayment({
    amount: session.totalAmount,
    currency: session.currency,
    orderReference,
    description: `Order ${session.sourceIdentifier}`,
    returnUrl,
    callbackUrl,
    config: config.config as Record<string, string>,
  });

  const attempt = await prisma.paymentAttempt.create({
    data: {
      checkoutSessionId: session.id,
      provider,
      amount: session.totalAmount,
      providerReference: result.providerReference,
      requestPayload: result.requestPayload as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });

  await prisma.checkoutSession.update({
    where: { id: session.id },
    data: { status: "PAYMENT_PENDING", paymentProvider: provider },
  });

  const sessionAttrs = (session.customAttributes ?? {}) as Record<string, unknown>;
  const ab = (sessionAttrs.ab ?? {}) as Record<string, string>;
  if (ab.experimentId && ab.visitorId && ab.variant) {
    const { logCheckoutAbEvent } = await import("@/lib/checkout-ab/events");
    await logCheckoutAbEvent({
      experimentId: ab.experimentId,
      visitorId: ab.visitorId,
      variant: ab.variant,
      eventName: "payment_started",
      checkoutSessionId: session.id,
      payload: { provider },
    });
  }

  return { attempt, ...result };
}

export async function handlePaymentCallback(
  provider: PaymentProvider,
  rawBody: string | Buffer,
  headers: Record<string, string | undefined>
) {
  const webhookSource = provider.toLowerCase();
  const deliveryId =
    headers["x-shopify-webhook-id"] ??
    headers["x-sign"]?.slice(0, 32) ??
    Buffer.from(rawBody.toString()).toString("base64").slice(0, 32);

  const adapter = getPaymentAdapter(provider);
  const providerReference = extractUnverifiedProviderReference(provider, rawBody);
  if (!providerReference) throw new Error("Payment reference not found");

  const paymentAttempt = await prisma.paymentAttempt.findUnique({
    where: {
      provider_providerReference: {
        provider,
        providerReference,
      },
    },
    include: {
      checkoutSession: {
        include: {
          merchant: {
            include: {
              paymentConfigs: true,
            },
          },
        },
      },
    },
  });
  if (!paymentAttempt) throw new Error("Payment attempt not found");

  const { recordWebhookDelivery } = await import("@/lib/idempotency");
  const isNew = await recordWebhookDelivery({
    source: webhookSource,
    deliveryId,
    merchantId: paymentAttempt.checkoutSession.merchantId,
    payload: rawBody.toString(),
    verified: false,
  });
  if (!isNew) return { duplicate: true };

  const configRecord = paymentAttempt.checkoutSession.merchant.paymentConfigs.find(
    (config) => config.provider === provider && config.isEnabled
  );
  if (!configRecord) throw new Error("Payment config not enabled for merchant");

  const parsed = adapter.verifyCallback(
    rawBody,
    headers,
    configRecord.config as Record<string, string>
  );

  if (!parsed) throw new Error("Invalid callback");
  if (parsed.providerReference !== paymentAttempt.providerReference) {
    throw new Error("Callback payment reference mismatch");
  }

  if (provider === "MONOBANK") {
    const { verifyMonobankCallback } = await import("@/lib/payments/monobank");
    const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const valid = await verifyMonobankCallback(
      bodyBuf,
      headers["x-sign"] ?? "",
      (configRecord.config as Record<string, string>).token
    );
    if (!valid) throw new Error("Invalid Monobank signature");
  }

  await prisma.webhookDelivery.update({
    where: { source_deliveryId: { source: webhookSource, deliveryId } },
    data: { verified: true },
  });

  if (
    paymentAttempt.modifiedAtProvider &&
    parsed.modifiedAt &&
    parsed.modifiedAt <= paymentAttempt.modifiedAtProvider
  ) {
    return { duplicate: true, status: paymentAttempt.status };
  }

  const statusMap: Record<string, PaymentStatus> = {
    PAID: "PAID",
    FAILED: "FAILED",
    PENDING: "PENDING",
  };

  const newStatus = statusMap[parsed.status] ?? "PENDING";

  await prisma.paymentAttempt.update({
    where: { id: paymentAttempt.id },
    data: {
      status: newStatus,
      callbackPayload: parsed.rawPayload as Prisma.InputJsonValue,
      verifiedAt: new Date(),
      modifiedAtProvider: parsed.modifiedAt,
    },
  });

  await prisma.webhookDelivery.update({
    where: { source_deliveryId: { source: webhookSource, deliveryId } },
    data: { processedAt: new Date() },
  });

  if (newStatus === "PAID") {
    await prisma.checkoutSession.update({
      where: { id: paymentAttempt.checkoutSessionId },
      data: { status: "PAID" },
    });

    await ensureShopifyOrderCreation(paymentAttempt.checkoutSessionId);

    const sessionAttrs = (paymentAttempt.checkoutSession.customAttributes ?? {}) as Record<
      string,
      unknown
    >;
    const ab = (sessionAttrs.ab ?? {}) as Record<string, string>;
    if (ab.experimentId && ab.visitorId && ab.variant) {
      const { logCheckoutAbEvent } = await import("@/lib/checkout-ab/events");
      await logCheckoutAbEvent({
        experimentId: ab.experimentId,
        visitorId: ab.visitorId,
        variant: ab.variant,
        eventName: "payment_success",
        checkoutSessionId: paymentAttempt.checkoutSessionId,
        revenue: paymentAttempt.amount / 100,
        currency: paymentAttempt.checkoutSession.currency,
        payload: { providerReference: parsed.providerReference },
      });
    }

    logWithCorrelation("info", "Payment confirmed", {
      checkoutSessionId: paymentAttempt.checkoutSessionId,
      paymentAttemptId: paymentAttempt.id,
      providerReference: parsed.providerReference,
    });
  }

  return { status: newStatus, checkoutSessionId: paymentAttempt.checkoutSessionId };
}

export function selectFinalPaidAttempt(
  attempts: Array<{ status: string; modifiedAtProvider: Date | null; createdAt: Date }>
) {
  return attempts.find((a) => a.status === "PAID") ?? null;
}
