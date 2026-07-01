import { prisma } from "@/lib/db";
import { getPaymentAdapter } from "@/lib/payments/index";
import { getLiqPayCallbackUrl } from "@/lib/payments/liqpay";
import { getMonobankCallbackUrl } from "@/lib/payments/monobank";
import { getEnv } from "@/lib/env";
import { enqueueJob, QUEUE_NAMES } from "@/lib/queue";
import { logWithCorrelation } from "@/lib/logger";
import type { PaymentProvider, PaymentStatus, Prisma } from "@prisma/client";

function getCallbackUrl(provider: PaymentProvider) {
  if (provider === "LIQPAY") return getLiqPayCallbackUrl();
  if (provider === "MONOBANK") return getMonobankCallbackUrl();
  return `${getEnv().APP_URL}/api/callbacks/${provider.toLowerCase()}`;
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
  const deliveryId =
    headers["x-shopify-webhook-id"] ??
    headers["x-sign"]?.slice(0, 32) ??
    Buffer.from(rawBody.toString()).toString("base64").slice(0, 32);

  const { recordWebhookDelivery } = await import("@/lib/idempotency");
  const isNew = await recordWebhookDelivery({
    source: provider.toLowerCase(),
    deliveryId,
    payload: rawBody.toString(),
    verified: true,
  });
  if (!isNew) return { duplicate: true };

  const adapter = getPaymentAdapter(provider);
  const configRecord = await prisma.paymentProviderConfig.findFirst({
    where: { provider, isEnabled: true },
  });
  if (!configRecord) throw new Error("No payment config");

  const parsed = adapter.verifyCallback(
    rawBody,
    headers,
    configRecord.config as Record<string, string>
  );

  if (!parsed) throw new Error("Invalid callback");

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

  const paymentAttempt = await prisma.paymentAttempt.findFirst({
    where: {
      provider,
      providerReference: parsed.providerReference,
    },
    include: { checkoutSession: true },
  });
  if (!paymentAttempt) throw new Error("Payment attempt not found");

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

  if (newStatus === "PAID") {
    await prisma.checkoutSession.update({
      where: { id: paymentAttempt.checkoutSessionId },
      data: { status: "PAID" },
    });

    await enqueueJob(QUEUE_NAMES.ORDERS, "create-shopify-order", {
      checkoutSessionId: paymentAttempt.checkoutSessionId,
    });

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
