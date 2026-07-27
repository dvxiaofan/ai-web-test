import { describe, it, expect } from "vitest";
import { buildStateModel } from "../../src/business/state-model.js";
import type { BusinessActionNode, StateNode } from "../../src/business/types.js";

const states: StateNode[] = [
  { id: "st:draft", kind: "state", name: "草稿", moduleId: "mod:orders", isInitial: true },
  { id: "st:submitted", kind: "state", name: "已提交", moduleId: "mod:orders" },
  { id: "st:cancelled", kind: "state", name: "已取消", moduleId: "mod:orders", isTerminal: true },
];

const submitAction: BusinessActionNode = {
  id: "ba:mod:orders:submit",
  kind: "business-action",
  name: "submit order",
  moduleId: "mod:orders",
  verbs: ["submit"],
  routeIds: ["rt:orders:submit"],
  pageIds: [],
  statesBefore: ["st:draft"],
  statesAfter: ["st:submitted"],
  requiredRoleIds: ["role:user"],
  ruleIds: [],
};

describe("buildStateModel", () => {
  const model = buildStateModel([submitAction], states);

  it("returns the provided states", () => {
    expect(model.states.map((s) => s.id)).toEqual(["st:draft", "st:submitted", "st:cancelled"]);
  });

  it("derives transitions from before/after pairs", () => {
    expect(model.transitions).toHaveLength(1);
    expect(model.transitions[0].fromStateId).toBe("st:draft");
    expect(model.transitions[0].toStateId).toBe("st:submitted");
    expect(model.transitions[0].actionId).toBe("ba:mod:orders:submit");
  });

  it("identifies initial and terminal states", () => {
    expect(model.initialStates).toEqual(["st:draft"]);
    expect(model.terminalStates).toEqual(["st:cancelled"]);
  });

  it("returns an empty model when actions declare no states", () => {
    const empty = buildStateModel([]);
    expect(empty.states).toEqual([]);
    expect(empty.transitions).toEqual([]);
    expect(empty.initialStates).toEqual([]);
  });
});
