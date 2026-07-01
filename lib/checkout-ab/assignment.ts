import { prisma } from "@/lib/db";
import {
  AB_VARIANTS,
  getCheckoutAbConfig,
  type AbVariant,
} from "@/lib/checkout-ab/config";
import { stableHashBucket } from "@/lib/checkout-ab/hash";
import { logCheckoutAbEvent } from "@/lib/checkout-ab/events";

export type AssignVariantInput = {
  visitorId: string;
  forceCheckout?: "chekly" | "custom" | null;
};

export type AssignVariantResult = {
  experimentId: string;
  visitorId: string;
  variant: AbVariant;
  forced: boolean;
  isNewAssignment: boolean;
};

function pickVariantFromBucket(visitorId: string, experimentId: string, customWeight: number): AbVariant {
  const bucket = stableHashBucket(`${experimentId}:${visitorId}`);
  return bucket < customWeight ? AB_VARIANTS.CUSTOM : AB_VARIANTS.CHEKLY;
}

export async function assignCheckoutVariant(
  input: AssignVariantInput
): Promise<AssignVariantResult> {
  const config = getCheckoutAbConfig();
  const experimentId = config.CHECKOUT_AB_EXPERIMENT_ID;

  const existing = await prisma.checkoutAbAssignment.findUnique({
    where: {
      experimentId_visitorId: {
        experimentId,
        visitorId: input.visitorId,
      },
    },
  });

  if (existing) {
    return {
      experimentId,
      visitorId: input.visitorId,
      variant: existing.variant as AbVariant,
      forced: false,
      isNewAssignment: false,
    };
  }

  let variant: AbVariant;
  let forced = false;

  if (input.forceCheckout === "chekly") {
    variant = AB_VARIANTS.CHEKLY;
    forced = true;
  } else if (input.forceCheckout === "custom") {
    variant = AB_VARIANTS.CUSTOM;
    forced = true;
  } else if (!config.CUSTOM_CHECKOUT_ENABLED) {
    variant = AB_VARIANTS.CHEKLY;
    forced = true;
  } else {
    variant = pickVariantFromBucket(
      input.visitorId,
      experimentId,
      config.CUSTOM_WEIGHT
    );
  }

  await prisma.checkoutAbAssignment.create({
    data: {
      experimentId,
      visitorId: input.visitorId,
      variant,
    },
  });

  await logCheckoutAbEvent({
    experimentId,
    visitorId: input.visitorId,
    variant,
    eventName: "variant_assigned",
    payload: { forced, customWeight: config.CUSTOM_WEIGHT },
  });

  return {
    experimentId,
    visitorId: input.visitorId,
    variant,
    forced,
    isNewAssignment: true,
  };
}
