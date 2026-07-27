import { describe, expect, it } from "vitest";
import { importProposals, mergeCatalog } from "../../src/scenarios/importer.js";
import { buildTestInventory, buildValidProposal } from "../fixtures/inventory.js";

describe("importProposals", () => {
  it("lowers a valid proposal into a TestScenario with resolved references", () => {
    const inventory = buildTestInventory();
    const result = importProposals([buildValidProposal()], inventory);
    expect(result.rejected).toEqual([]);
    expect(result.scenarios).toHaveLength(1);
    const scenario = result.scenarios[0];
    expect(scenario.routeIds).toEqual(["r-users-list"]);
    expect(scenario.moduleIds).toEqual(["mod-users"]);
    expect(scenario.roleIds).toEqual(["role-admin"]);
    expect(scenario.source).toBe("generated");
    expect(scenario.steps.map((s) => s.action)).toEqual(["navigate", "screenshot"]);
  });

  it("rejects proposals that fail inventory validation", () => {
    const inventory = buildTestInventory();
    const result = importProposals([buildValidProposal({ routeId: "ghost" })], inventory);
    expect(result.scenarios).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("produces a stable scenario id so re-imports merge idempotently", () => {
    const inventory = buildTestInventory();
    const first = importProposals([buildValidProposal()], inventory).scenarios;
    const second = importProposals([buildValidProposal()], inventory).scenarios;
    expect(first[0].id).toBe(second[0].id);
    const merged = mergeCatalog(first, second);
    expect(merged).toHaveLength(1);
  });

  it("imports a mutate-risk proposal with a fill step", () => {
    const inventory = buildTestInventory();
    const proposal = buildValidProposal({
      name: "Create user",
      risk: "mutate",
      steps: [{ action: "fill", locator: { strategy: "role", value: "textbox", name: "Name" }, value: "Bob" }],
    });
    const result = importProposals([proposal], inventory);
    expect(result.rejected).toEqual([]);
    expect(result.scenarios[0].steps[0].action).toBe("fill");
  });

  it("rejects a read-only proposal that performs a mutating step", () => {
    const inventory = buildTestInventory();
    const proposal = buildValidProposal({
      name: "Bad fill",
      risk: "read",
      steps: [{ action: "fill", locator: { strategy: "role", value: "textbox", name: "Name" }, value: "Bob" }],
    });
    const result = importProposals([proposal], inventory);
    expect(result.scenarios).toEqual([]);
    expect(result.rejected[0].reason).toContain("mutate");
  });
});
