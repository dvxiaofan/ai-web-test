import { describe, it, expect } from "vitest";
import { buildSampleInventory } from "../fixtures/business.js";
import { buildBusinessInventory } from "../../src/business/assemble.js";
import { computeBusinessGaps, computeBusinessCoverage } from "../../src/business/gaps.js";
import type { BusinessInventory, BusinessNode } from "../../src/business/types.js";

describe("computeBusinessGaps (sample)", () => {
  const inventory = buildSampleInventory();
  const business = buildBusinessInventory(inventory);
  const gaps = computeBusinessGaps(inventory, business);

  it("flags guest as a role without permission", () => {
    const g = gaps.find((x) => x.type === "role-without-permission" && x.targetId === "role:guest");
    expect(g).toBeDefined();
    expect(g!.severity).toBe("info");
  });

  it("covers all sample actions via rules + permissions", () => {
    expect(gaps.filter((x) => x.type === "uncovered-action")).toHaveLength(0);
  });
});

describe("computeBusinessGaps (custom)", () => {
  const inventory = buildSampleInventory();
  const nodes: Record<string, BusinessNode> = {
    "ba:mod:orders:ghost": {
      id: "ba:mod:orders:ghost",
      kind: "business-action",
      name: "ghost action",
      moduleId: "mod:orders",
      verbs: ["read"],
      routeIds: [],
      pageIds: [],
      statesBefore: [],
      statesAfter: [],
      requiredRoleIds: [],
      ruleIds: [],
    },
    "ent:order": {
      id: "ent:order",
      kind: "entity",
      name: "Order",
      moduleId: "mod:orders",
      fields: [],
    },
    "stt:bad": {
      id: "stt:bad",
      kind: "state-transition",
      name: "bad transition",
      moduleId: "mod:orders",
      fromStateId: "st:none",
      toStateId: "st:other",
      actionId: "ba:mod:orders:ghost",
    },
  };
  const business: BusinessInventory = { schemaVersion: 1, generatedAt: "x", nodes };
  const gaps = computeBusinessGaps(inventory, business);

  it("flags an uncovered action", () => {
    expect(gaps.find((x) => x.type === "uncovered-action" && x.targetId === "ba:mod:orders:ghost")).toBeDefined();
  });
  it("flags an orphan entity", () => {
    expect(gaps.find((x) => x.type === "orphan-entity" && x.targetId === "ent:order")).toBeDefined();
  });
  it("flags an uncovered state transition as high severity", () => {
    const g = gaps.find((x) => x.type === "uncovered-state-transition");
    expect(g).toBeDefined();
    expect(g!.severity).toBe("error");
  });
});

describe("computeBusinessCoverage", () => {
  const inventory = buildSampleInventory();
  const business = buildBusinessInventory(inventory);
  const report = computeBusinessCoverage(inventory, business);

  it("reports full coverage for the sample", () => {
    expect(report.project).toBe("sample");
    expect(report.summary.actions).toBe(7);
    expect(report.summary.coverageRatio).toBe(1);
    expect(report.modules.find((m) => m.moduleId === "mod:orders")!.actionsTotal).toBe(5);
  });
});
