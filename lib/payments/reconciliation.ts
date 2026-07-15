import type { PaymentAttempt, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPaymentAdapter } from "@/lib/payments";
import { createShopifyOrderIdempotent } from "@/lib/shopify/order-writer";
import { assertPaymentIntegrity } from "@/lib/payments/integrity";
import { decryptPaymentConfig } from "@/lib/payments/config-secrets";

type PendingAttempt = PaymentAttempt & {
  checkoutSession: {
    id: string;
    publicToken: string;
    merchantId: string;
    currency: string;
    sourceIdentifier: string | null;
    orderLink: { shopifyOrderName: string | null; shopifyOrderGid: string | null } | null;
    merchant: {
      paymentConfigs: Array<{
        provider: PaymentAttempt["provider"];
        isEnabled: boolean;
        config: Prisma.JsonValue;
      }>;
    };
  };
};

export async function reconcilePendingPaymentAttempt(attempt: PendingAttempt) {
  if (!attempt.providerReference) {
    return {
      paymentAttemptId: attempt.id,
      checkoutSessionId: attempt.checkoutSessionId,
      status: "skipped",
      reason: "missing providerReference",
    };
  }

  const config = attempt.checkoutSession.merchant.paymentConfigs.find(
    (item) => item.provider === attempt.provider && item.isEnabled
  );
  const adapter = getPaymentAdapter(attempt.provider);
  if (!config || !adapter.getFinalStatus) {
    return {
      paymentAttemptId: attempt.id,
      checkoutSessionId: attempt.checkoutSessionId,
      providerReference: attempt.providerReference,
      status: "skipped",
      reason: "provider status polling unavailable",
    };
  }

  const finalStatus = await adapter.getFinalStatus(
    attempt.providerReference,
    decryptPaymentConfig(config.config as Record<string, string>)
  );
  if (!finalStatus) {
    return {
      paymentAttemptId: attempt.id,
      checkoutSessionId: attempt.checkoutSessionId,
      providerReference: attempt.providerReference,
      status: "pending",
    };
  }

  assertPaymentIntegrity({
    expectedAmount: attempt.amount,
    actualAmount: finalStatus.amount,
    expectedCurrency: attempt.checkoutSession.currency,
    actualCurrency: finalStatus.currency,
  });

  await prisma.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: finalStatus.status,
      callbackPayload: finalStatus.rawPayload as Prisma.InputJsonValue,
      verifiedAt: finalStatus.status === "PAID" ? new Date() : attempt.verifiedAt,
      modifiedAtProvider: finalStatus.modifiedAt ?? attempt.modifiedAtProvider,
    },
  });

  let shopifyOrderName = attempt.checkoutSession.orderLink?.shopifyOrderName ?? null;
  if (finalStatus.status === "PAID") {
    await prisma.checkoutSession.update({
      where: { id: attempt.checkoutSessionId },
      data: { status: "PAID" },
    });

    const orderLink = await createShopifyOrderIdempotent(attempt.checkoutSessionId);
    shopifyOrderName = orderLink.shopifyOrderName;
  }

  return {
    paymentAttemptId: attempt.id,
    checkoutSessionId: attempt.checkoutSessionId,
    publicToken: attempt.checkoutSession.publicToken,
    sourceIdentifier: attempt.checkoutSession.sourceIdentifier,
    providerReference: attempt.providerReference,
    status: finalStatus.status,
    shopifyOrderName,
    shopifyOrderGid: attempt.checkoutSession.orderLink?.shopifyOrderGid ?? null,
  };
}

export async function reconcilePendingPayments(input?: {
  merchantId?: string;
  checkoutSessionId?: string;
  take?: number;
}) {
  const attempts = await prisma.paymentAttempt.findMany({
    where: {
      status: "PENDING",
      checkoutSessionId: input?.checkoutSessionId,
      checkoutSession: input?.merchantId ? { merchantId: input.merchantId } : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: input?.take ?? 20,
    include: {
      checkoutSession: {
        include: {
          merchant: { include: { paymentConfigs: true } },
          orderLink: true,
        },
      },
    },
  });

  const results = [];
  for (const attempt of attempts) {
    try {
      results.push(await reconcilePendingPaymentAttempt(attempt));
    } catch (error) {
      results.push({
        paymentAttemptId: attempt.id,
        checkoutSessionId: attempt.checkoutSessionId,
        providerReference: attempt.providerReference,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: attempts.length, results };
}
