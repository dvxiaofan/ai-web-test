import { describe, it, expect } from "vitest";
import { createNamespace, stableIdForNamespace, validateNamespaceShape } from "../../src/testdata/namespace.js";
import type { TestDataNamespace } from "../../src/testdata/types.js";

describe("createNamespace", () => {
  const ns = createNamespace({
    name: "Orders Fixture",
    moduleId: "mod:orders",
    scope: "module",
    records: [{ id: "r1", kind: "entity", name: "order", payload: { id: 1 } }],
  });

  it("produces a content-addressed id", () => {
    expect(ns.id).toBe("tdns:mod:orders:orders-fixture");
    expect(stableIdForNamespace("mod:orders", "Orders Fixture")).toBe(ns.id);
  });

  it("defaults scope to module", () => {
    const plain = createNamespace({ name: "x", moduleId: "m" });
    expect(plain.scope).toBe("module");
  });
});

describe("validateNamespaceShape", () => {
  it("accepts a well-formed namespace", () => {
    const ns: TestDataNamespace = {
      id: "tdns:m:x",
      schemaVersion: 1,
      name: "x",
      moduleId: "m",
      scope: "module",
      records: [{ id: "r1", kind: "entity", name: "e", payload: {} }],
    };
    expect(validateNamespaceShape(ns).valid).toBe(true);
  });

  it("rejects a namespace with a bad cleanupOrder reference", () => {
    const ns: TestDataNamespace = {
      id: "tdns:m:x",
      schemaVersion: 1,
      name: "x",
      moduleId: "m",
      scope: "module",
      records: [{ id: "r1", kind: "entity", name: "e", payload: {} }],
      cleanupOrder: ["missing"],
    };
    const result = validateNamespaceShape(ns);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing"))).toBe(true);
  });
});
