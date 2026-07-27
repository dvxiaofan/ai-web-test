import { describe, it, expect } from "vitest";
import { proposeBusinessScenarios } from "../../src/ai/scenario-planner.js";
import { buildSampleInventory } from "../fixtures/business.js";
import { buildBusinessInventory } from "../../src/business/assemble.js";
import type { BusinessInventory, BusinessNode } from "../../src/business/types.js";

describe("proposeBusinessScenarios (permission denied)", () => {
  const inventory = buildSampleInventory();
  const business = buildBusinessInventory(inventory);
  const proposals = proposeBusinessScenarios(inventory, business);

  it("creates a denied-access proposal for every denied role on restricted actions", () => {
    // 受限动作：read/create(orders) + cancel/delete(orders) + list/create(users) = 6 个权限
    // denied 数：1+1+2+2+2+2 = 10
    expect(proposals).toHaveLength(10);
    expect(proposals.every((p) => p.tags.includes("negative"))).toBe(true);
    expect(proposals.every((p) => p.risk === "mutate")).toBe(true);
  });

  it("includes a denied proposal for guest on cancel order", () => {
    const p = proposals.find((x) => x.name === "拒绝 guest 执行 cancel order");
    expect(p).toBeDefined();
    expect(p!.routeIds).toContain("rt:orders:cancel");
    expect(p!.assumptions[0]).toContain("perm:ba:mod:orders:cancel");
  });

  it("does not create negative proposals for public actions", () => {
    expect(proposals.find((x) => x.name.includes("list order"))).toBeUndefined();
  });
});

describe("proposeBusinessScenarios (state transition)", () => {
  const inventory = buildSampleInventory();
  const nodes: Record<string, BusinessNode> = {
    "ba:mod:orders:submit": {
      id: "ba:mod:orders:submit",
      kind: "business-action",
      name: "submit order",
      moduleId: "mod:orders",
      verbs: ["submit"],
      routeIds: ["rt:orders:create"],
      pageIds: [],
      statesBefore: ["st:draft"],
      statesAfter: ["st:submitted"],
      requiredRoleIds: ["role:user"],
      ruleIds: [],
    },
    "stt:submit": {
      id: "stt:submit",
      kind: "state-transition",
      name: "draft → submitted",
      moduleId: "mod:orders",
      fromStateId: "st:draft",
      toStateId: "st:submitted",
      actionId: "ba:mod:orders:submit",
    },
  };
  const business: BusinessInventory = { schemaVersion: 1, generatedAt: "x", nodes };
  const proposals = proposeBusinessScenarios(inventory, business);

  it("creates a proposal exercising the transition", () => {
    expect(proposals).toHaveLength(1); // 自定义 business 无权限节点，仅 1 条状态迁移提案
    const transition = proposals.find((p) => p.tags.includes("state-transition"));
    expect(transition).toBeDefined();
    expect(transition!.steps.map((s) => s.action)).toEqual(["navigate", "perform", "assertState"]);
  });
});
