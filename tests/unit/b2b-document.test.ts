import { describe, expect, it } from "vitest";
import { isPrismaUniqueConstraintError } from "@/lib/documents/b2b-document";

describe("B2B document conflicts", () => {
  it("recognizes Prisma's duplicate-record error", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2002" })).toBe(true);
  });

  it("does not mask unrelated errors", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2025" })).toBe(false);
    expect(isPrismaUniqueConstraintError(new Error("network error"))).toBe(false);
  });
});
