import { describe, expect, it } from "vitest";
import { AB_VARIANTS } from "@/lib/checkout-ab/config";
import { stableHashBucket } from "@/lib/checkout-ab/hash";

describe("checkout A/B assignment hash", () => {
  it("returns stable bucket for same input", () => {
    const a = stableHashBucket("checkout_router_2026_06:visitor-123");
    const b = stableHashBucket("checkout_router_2026_06:visitor-123");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it("distributes visitors between variants by weight", () => {
    const experimentId = "checkout_router_2026_06";
    const customWeight = 10;
    let custom = 0;
    const total = 1000;

    for (let i = 0; i < total; i++) {
      const bucket = stableHashBucket(`${experimentId}:visitor-${i}`);
      const variant =
        bucket < customWeight ? AB_VARIANTS.CUSTOM : AB_VARIANTS.CHEKLY;
      if (variant === AB_VARIANTS.CUSTOM) custom++;
    }

    const ratio = custom / total;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });
});
