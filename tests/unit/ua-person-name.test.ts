import { describe, expect, it } from "vitest";
import { normalizeUaPersonName } from "@/lib/checkout/ua-person-name";

describe("normalizeUaPersonName", () => {
  it("fixes Latin lookalikes inside Cyrillic names (UA1193)", () => {
    // Latin i (U+0069) instead of Ukrainian і (U+0456)
    expect(normalizeUaPersonName("Наталiя")).toBe("Наталія");
    expect(normalizeUaPersonName("Наталiя")?.charCodeAt(5)).toBe(0x0456);
  });

  it("transliterates pure Latin names for Nova Poshta", () => {
    expect(normalizeUaPersonName("Svitlana")).toBe("Світлана");
    expect(normalizeUaPersonName("Marina")).toBe("Маріна");
    expect(normalizeUaPersonName("Mishchenko")).toMatch(/^Міщенко$|^Мішченко$/);
  });

  it("leaves pure Cyrillic unchanged", () => {
    expect(normalizeUaPersonName("Наталія")).toBe("Наталія");
    expect(normalizeUaPersonName("Монастирська")).toBe("Монастирська");
    expect(normalizeUaPersonName("Ірина")).toBe("Ірина");
  });

  it("preserves nullish and empty", () => {
    expect(normalizeUaPersonName(null)).toBeNull();
    expect(normalizeUaPersonName(undefined)).toBeUndefined();
    expect(normalizeUaPersonName("")).toBe("");
    expect(normalizeUaPersonName("   ")).toBe("");
  });

  it("trims whitespace", () => {
    expect(normalizeUaPersonName("  Наталiя  ")).toBe("Наталія");
  });
});
