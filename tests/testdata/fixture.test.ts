import { describe, it, expect } from "vitest";
import { compileFixture, validateFixture } from "../../src/testdata/fixture.js";

const raw = [
  { name: "order-1", kind: "entity" as const, payload: { id: 1 }, cleanup: "auto" as const },
  { name: "order-2", kind: "row" as const, payload: { id: 2 }, cleanup: "manual" as const },
];

describe("compileFixture", () => {
  const records = compileFixture({ namespaceId: "tdns:m:x", raw });

  it("normalizes records with deterministic ids", () => {
    expect(records).toHaveLength(2);
    expect(records[0]!.id).toBe("tdns:m:x:order-1");
    expect(records[1]!.id).toBe("tdns:m:x:order-2");
    expect(records[0]!.cleanup).toBe("auto");
    expect(records[1]!.cleanup).toBe("manual");
  });
});

describe("validateFixture", () => {
  it("accepts a valid raw fixture", () => {
    expect(validateFixture(raw).valid).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(validateFixture({ name: "x" }).valid).toBe(false);
  });

  it("rejects a record with an illegal kind", () => {
    const bad = [{ name: "x", kind: "bogus", payload: {} }] as unknown;
    const result = validateFixture(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("kind"))).toBe(true);
  });
});
