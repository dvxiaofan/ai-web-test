import { describe, it, expect } from "vitest";
import { buildCleanupPlan, orderAfterFailure } from "../../src/testdata/cleanup.js";
import type { TestDataNamespace } from "../../src/testdata/types.js";

const ns: TestDataNamespace = {
  id: "tdns:m:x",
  schemaVersion: 1,
  name: "x",
  moduleId: "m",
  scope: "module",
  records: [
    { id: "r1", kind: "entity", name: "e1", payload: {} },
    { id: "r2", kind: "entity", name: "e2", payload: {}, cleanup: "manual" },
    { id: "r3", kind: "row", name: "row", payload: {} },
  ],
};

describe("buildCleanupPlan", () => {
  it("defaults to reverse order with manual records last", () => {
    const plan = buildCleanupPlan(ns);
    // auto: r3, r1 ; manual: r2 -> [r3, r1, r2]
    expect(plan.order).toEqual(["r3", "r1", "r2"]);
  });

  it("honors an explicit cleanupOrder", () => {
    const plan = buildCleanupPlan({ ...ns, cleanupOrder: ["r2", "r1", "r3"] });
    expect(plan.order).toEqual(["r2", "r1", "r3"]);
  });
});

describe("orderAfterFailure", () => {
  it("aborts remaining cleanup on failure when onFailure=abort", () => {
    const plan = buildCleanupPlan(ns, "abort");
    const { remaining, aborted } = orderAfterFailure(plan, "r1");
    expect(aborted).toBe(true);
    expect(remaining).toContain("r1");
    expect(remaining).not.toContain("r2");
  });

  it("skips the failed record and continues when onFailure=continue", () => {
    const plan = buildCleanupPlan(ns, "continue");
    const { remaining, aborted } = orderAfterFailure(plan, "r1");
    expect(aborted).toBe(false);
    expect(remaining).not.toContain("r1");
    expect(remaining).toContain("r2");
  });
});
