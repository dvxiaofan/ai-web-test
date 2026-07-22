import { describe, expect, it } from "vitest";

import { computeDependencyClosure } from "../../src/planning/dependencies.js";
import { selectScenarios, validateScope } from "../../src/planning/selectors.js";
import { makeInventory, makeScenario } from "./fixtures.js";

describe("planning selectors and dependency closure", () => {
  const scenarios = [
    makeScenario("scenario-order", "module-orders", { roleIds: ["role-user"], tags: ["orders", "critical"] }),
    makeScenario("scenario-login", "module-auth", { tags: ["smoke"] }),
    makeScenario("scenario-search", "module-orders", { tags: ["smoke"] }),
  ];

  it("selects by module, tag, role, and route", () => {
    const inventory = makeInventory();
    expect(selectScenarios(inventory, scenarios, { mode: "module", moduleIds: ["module-orders"], includeDependencies: false }).selectedScenarioIds)
      .toEqual(["scenario-order", "scenario-search"]);
    expect(selectScenarios(inventory, scenarios, { mode: "tag", tags: ["smoke"], includeDependencies: false }).selectedScenarioIds)
      .toEqual(["scenario-login", "scenario-search"]);
    expect(selectScenarios(inventory, scenarios, { mode: "role", roleIds: ["role-user"], includeDependencies: false }).selectedScenarioIds)
      .toEqual(["scenario-order"]);
  });

  it("includes declared prerequisites before the selected scenario", () => {
    const inventory = makeInventory();
    const selected = selectScenarios(inventory, [
      makeScenario("scenario-order", "module-orders", { prerequisites: ["scenario-login"] }),
      makeScenario("scenario-login", "module-auth"),
    ], { mode: "scenario", scenarioIds: ["scenario-order"], includeDependencies: true });
    expect(selected.selectedScenarioIds).toEqual(["scenario-login", "scenario-order"]);
    expect(selected.autoIncludedScenarioIds).toEqual(["scenario-login"]);
  });

  it("resolves inventory depends-on and prepares edges", () => {
    const inventory = makeInventory([
      { id: "edge-prepare", from: "node-scenario-login", to: "node-scenario-order", relationship: "prepares", confidence: 1, evidence: [] },
    ]);
    const closure = computeDependencyClosure(["scenario-order"], [
      makeScenario("scenario-order", "module-orders"),
      makeScenario("scenario-login", "module-auth"),
    ], inventory);
    expect(closure.scenarioIds).toEqual(["scenario-login", "scenario-order"]);
  });

  it("reports missing dependencies and cycles instead of hanging", () => {
    const inventory = makeInventory();
    const missing = computeDependencyClosure(["scenario-order"], [makeScenario("scenario-order", "module-orders", { prerequisites: ["not-found"] })], inventory);
    expect(missing.missingDependencyIds).toEqual(["not-found"]);
    const cycle = computeDependencyClosure(["a"], [
      makeScenario("a", "module-orders", { prerequisites: ["b"] }),
      makeScenario("b", "module-orders", { prerequisites: ["a"] }),
    ], inventory);
    expect(cycle.dependencyCycles).toHaveLength(1);
  });

  it("validates required selectors and preserves unmatched selector diagnostics", () => {
    expect(validateScope({ mode: "module", includeDependencies: true })).toContain("Module scope requires at least one module ID.");
    const selection = selectScenarios(makeInventory(), scenarios, { mode: "module", moduleIds: ["does-not-exist"], includeDependencies: false });
    expect(selection.selectedScenarioIds).toEqual([]);
    expect(selection.unmatchedSelectors).toContain("module:does-not-exist");
  });
});
