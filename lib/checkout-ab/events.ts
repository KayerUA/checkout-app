import { prisma } from "@/lib/db";
import { hashPii } from "@/lib/checkout-ab/hash";
import type { Prisma } from "@prisma/client";

export type LogAbEventInput = {
  experimentId: string;
  visitorId: string;
  variant: string;
  eventName: string;
  cartToken?: string | null;
  checkoutSessionId?: string | null;
  shopifyOrderId?: string | null;
  email?: string | null;
  phone?: string | null;
  revenue?: number | null;
  currency?: string;
  payload?: Record<string, unknown> | null;
};

export async function logCheckoutAbEvent(input: LogAbEventInput) {
  return prisma.checkoutAbEvent.create({
    data: {
      experimentId: input.experimentId,
      visitorId: input.visitorId,
      variant: input.variant,
      eventName: input.eventName,
      cartToken: input.cartToken ?? undefined,
      checkoutSessionId: input.checkoutSessionId ?? undefined,
      shopifyOrderId: input.shopifyOrderId ?? undefined,
      emailHash: input.email ? hashPii(input.email) : undefined,
      phoneHash: input.phone ? hashPii(input.phone) : undefined,
      revenue: input.revenue ?? undefined,
      currency: input.currency ?? "UAH",
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
