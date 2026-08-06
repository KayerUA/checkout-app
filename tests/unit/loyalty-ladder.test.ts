import { describe, expect, it } from "vitest";
import {
  computeLoyaltyDiscount,
  parseOrderLoyaltyLadder,
  pickLoyaltyTier,
  type LoyaltyLadderResponse,
} from "@/lib/checkout/loyalty-ladder";

function ladderResponse(): LoyaltyLadderResponse {
  return {
    data: {
      automaticDiscountNodes: {
        nodes: [
          {
            automaticDiscount: {
              __typename: "DiscountAutomaticBasic",
              title: "KAYER Loyalty BRUTTO UA 10%",
              status: "ACTIVE",
              discountClasses: ["ORDER"],
              customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 } },
              minimumRequirement: {
                __typename: "DiscountMinimumSubtotal",
                greaterThanOrEqualToSubtotal: { amount: "6000.0" },
              },
            },
          },
          {
            automaticDiscount: {
              __typename: "DiscountAutomaticBasic",
              title: "KAYER Loyalty BRUTTO UA 15%",
              status: "ACTIVE",
              discountClasses: ["ORDER"],
              customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.15 } },
              minimumRequirement: {
                __typename: "DiscountMinimumSubtotal",
                greaterThanOrEqualToSubtotal: { amount: "8500.0" },
              },
            },
          },
          {
            automaticDiscount: {
              __typename: "DiscountAutomaticBasic",
              title: "KAYER Loyalty BRUTTO UA 5%",
              status: "ACTIVE",
              discountClasses: ["ORDER"],
              customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.05 } },
              minimumRequirement: {
                __typename: "DiscountMinimumSubtotal",
                greaterThanOrEqualToSubtotal: { amount: "3500.0" },
              },
            },
          },
          {
            automaticDiscount: {
              __typename: "DiscountAutomaticBasic",
              title: "KAYER UA Luxio B+S -15%",
              status: "ACTIVE",
              discountClasses: ["PRODUCT"],
              customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.15 } },
            },
          },
          {
            automaticDiscount: {
              __typename: "DiscountAutomaticBasic",
              title: "KAYER UA Loyalty 10pct min5",
              status: "EXPIRED",
              discountClasses: ["ORDER"],
              customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 } },
            },
          },
        ],
      },
    },
  };
}

describe("BRUTTO loyalty ladder", () => {
  it("keeps only active ORDER-class percentage discounts", () => {
    const tiers = parseOrderLoyaltyLadder(ladderResponse());

    expect(tiers.map((tier) => tier.percentage)).toEqual([5, 10, 15]);
    expect(tiers.map((tier) => tier.minimumSubtotalCents)).toEqual([350_000, 600_000, 850_000]);
  });

  it("gives a single best tier — tiers never stack with each other", () => {
    const tiers = parseOrderLoyaltyLadder(ladderResponse());

    expect(pickLoyaltyTier(tiers, 340_000)).toBeNull();
    expect(pickLoyaltyTier(tiers, 880_000)?.percentage).toBe(15);
    expect(pickLoyaltyTier(tiers, 700_000)?.percentage).toBe(10);
  });

  it("drops a tier when a promo code eats into the subtotal (UA1268)", () => {
    const tiers = parseOrderLoyaltyLadder(ladderResponse());
    const grossCents = 880_000;
    const promoCents = 32_550; // KAYERUA5 −5% on the eligible Luxio lines

    expect(computeLoyaltyDiscount(tiers, grossCents).discountCents).toBe(132_000);

    const afterPromo = computeLoyaltyDiscount(tiers, grossCents - promoCents);
    expect(afterPromo.tier?.percentage).toBe(10);
    expect(afterPromo.discountCents).toBe(84_745);
    expect(grossCents - promoCents - afterPromo.discountCents).toBe(762_705);
  });
});
