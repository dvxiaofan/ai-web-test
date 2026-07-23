import { describe, expect, it } from "vitest";

import {
  approvePlan,
  computeInventoryDigest,
  computePlanDigest,
  computeScenarioDigest,
  validateApprovedPlan,
} from "../../src/planning/approval.js";
import { proposePlan } from "../../src/planning/planner.js";
import { makeInventory, makePolicy, makeScenario } from "./fixtures.js";

describe("proposed plan and approval gate", () => {
  it("creates a deterministic proposed module plan with a digest", () => {
    const inventory = makeInventory();
    const result = proposePlan({
      inventory,
      scenarios: [makeScenario("scenario-order", "module-orders")],
      scope: { mode: "module", moduleIds: ["module-orders"], includeDependencies: true },
      target: { baseUrl: "http://app.test:3000", projectRoot: "/tmp/fixture" },
      policy: makePolicy(),
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(result.plan.status).toBe("proposed");
    expect(result.plan.scenarioIds).toEqual(["scenario-order"]);
    expect(result.plan.digest).toBe(computePlanDigest(result.plan));
    expect(result.validation.valid).toBe(true);
  });

  it("requires explicit approval and binds it to inventory and policy digests", () => {
    const inventory = makeInventory();
    const scenarios = [makeScenario("scenario-login", "module-auth")];
    const result = proposePlan({
      inventory,
      scenarios,
      scope: { mode: "scenario", scenarioIds: ["scenario-login"], includeDependencies: false },
      target: { baseUrl: "http://app.test:3000", projectRoot: "/tmp/fixture" },
      policy: makePolicy(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const approved = approvePlan(result.plan, { approvedBy: "operator", approvedAt: "2026-01-01T01:00:00.000Z" }, { inventory, scenarios, selection: result.selection });
    expect(approved.status).toBe("approved");
    expect(approved.approval?.approvedBy).toBe("operator");
    expect(validateApprovedPlan(approved, { inventory, scenarios, selection: result.selection }).valid).toBe(true);
  });

  it("rejects mutation plans without a test-data namespace or risk approval", () => {
    const inventory = makeInventory();
    const scenarios = [makeScenario("scenario-write", "module-orders", { risk: "mutate" })];
    const result = proposePlan({
      inventory,
      scenarios,
      scope: { mode: "scenario", scenarioIds: ["scenario-write"], includeDependencies: false },
      target: { baseUrl: "http://app.test:3000", projectRoot: "/tmp/fixture" },
      policy: makePolicy(),
    });
    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues.some((issue) => issue.code === "policy" || issue.code === "test-data")).toBe(true);
  });

  it("invalidates an approved plan if its policy is changed", () => {
    const inventory = makeInventory();
    const scenarios = [makeScenario("scenario-login", "module-auth")];
    const result = proposePlan({
      inventory,
      scenarios,
      scope: { mode: "scenario", scenarioIds: ["scenario-login"], includeDependencies: false },
      target: { baseUrl: "http://app.test:3000", projectRoot: "/tmp/fixture" },
      policy: makePolicy(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const approved = approvePlan(result.plan, { approvedBy: "operator" }, { inventory, scenarios, selection: result.selection });
    const tampered = { ...approved, policy: { ...approved.policy, maxRisk: "mutate" as const } };
    expect(validateApprovedPlan(tampered, { inventory, scenarios, selection: result.selection }).valid).toBe(false);
  });

  it("binds an approved plan to the selected scenario definitions", () => {
    const inventory = makeInventory();
    const scenarios = [makeScenario("scenario-login", "module-auth")];
    const result = proposePlan({
      inventory,
      scenarios,
      scope: { mode: "scenario", scenarioIds: ["scenario-login"], includeDependencies: false },
      target: { baseUrl: "http://app.test:3000", projectRoot: "/tmp/fixture" },
      policy: makePolicy(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const approved = approvePlan(result.plan, { approvedBy: "operator" }, { inventory, scenarios, selection: result.selection });
    const changedScenarios = [{
      ...scenarios[0]!,
      steps: [{ ...scenarios[0]!.steps[0]!, action: "navigate" as const, url: "/changed" }],
    }];

    const validation = validateApprovedPlan(approved, { inventory, scenarios: changedScenarios, selection: result.selection });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.message.includes("scenario definitions changed"))).toBe(true);
  });

  it("binds approval to the complete plan digest", () => {
    const inventory = makeInventory();
    const scenarios = [makeScenario("scenario-login", "module-auth")];
    const result = proposePlan({
      inventory,
      scenarios,
      scope: { mode: "scenario", scenarioIds: ["scenario-login"], includeDependencies: false },
      target: { baseUrl: "http://app.test:3000", projectRoot: "/tmp/fixture" },
      policy: makePolicy(),
    });
    const approved = approvePlan(result.plan, { approvedBy: "operator" }, { inventory, scenarios, selection: result.selection });
    const tampered = { ...approved, name: "tampered", digest: computePlanDigest({ ...approved, name: "tampered" }) };
    expect(validateApprovedPlan(tampered, { inventory, scenarios, selection: result.selection }).valid).toBe(false);
    expect(validateApprovedPlan(tampered, { inventory, scenarios, selection: result.selection }).issues.some((issue) => issue.message.includes("Plan contents changed"))).toBe(true);
  });

  it("uses a semantic inventory digest that ignores runtime evidence noise", () => {
    const inventory = makeInventory();
    const noisy = {
      ...inventory,
      generatedAt: "2026-02-02T00:00:00.000Z",
      coverage: {
        ...inventory.coverage,
        routes: { ...inventory.coverage.routes, visited: 2, rendered: 2 },
        unresolved: 9,
      },
      metadata: { browserExplorationStatus: "partial", browserPagesObserved: 2 },
      findings: [{
        id: "runtime-finding",
        category: "defect" as const,
        classification: "probable-defect" as const,
        severity: "medium" as const,
        status: "open" as const,
        confidence: 0.9,
        title: "Transient error",
        summary: "Observed once",
        evidence: [{ id: "runtime-evidence", kind: "runtime" as const, summary: "runtime", confidence: 1, observedAt: "2026-02-02T00:00:01.000Z", artifactPath: "/tmp/failure.png" }],
        relatedIds: [],
        createdAt: "2026-02-02T00:00:01.000Z",
      }],
      nodes: inventory.nodes.map((node) => ({
        ...node,
        confidence: 0.1,
        metadata: { rendered: true, controls: 4, screenshotPath: "/tmp/page.png" },
        evidence: [{ id: "volatile-evidence", kind: "runtime" as const, summary: "runtime", confidence: 1, observedAt: "2026-02-02T00:00:01.000Z", artifactPath: "/tmp/page.png", metadata: { durationMs: 42 } }],
      })),
    };
    expect(computeInventoryDigest(noisy)).toBe(computeInventoryDigest(inventory));

    const scenarios = [makeScenario("scenario-login", "module-auth")];
    const proposed = proposePlan({
      inventory,
      scenarios,
      scope: { mode: "scenario", scenarioIds: ["scenario-login"], includeDependencies: false },
      target: { baseUrl: "http://app.test:3000", projectRoot: "/tmp/fixture" },
      policy: makePolicy(),
    });
    const approved = approvePlan(proposed.plan, { approvedBy: "operator" }, { inventory, scenarios, selection: proposed.selection });
    expect(validateApprovedPlan(approved, { inventory: noisy, scenarios, selection: proposed.selection }).valid).toBe(true);

    const changed = {
      ...inventory,
      nodes: inventory.nodes.map((node) => node.id === "route-orders" ? { ...node, path: "/orders-v2" } : node),
    };
    expect(computeInventoryDigest(changed)).not.toBe(computeInventoryDigest(inventory));
  });

  it("ignores scenario provenance timestamps but detects executable changes", () => {
    const scenario = makeScenario("scenario-login", "module-auth");
    const provenanceOnly = {
      ...scenario,
      createdAt: "2027-01-01T00:00:00.000Z",
      updatedAt: "2027-01-01T00:00:01.000Z",
      evidence: [{ ...scenario.evidence[0]!, observedAt: "2027-01-01T00:00:01.000Z", artifactPath: "/tmp/new.png" }],
    };
    expect(computeScenarioDigest([provenanceOnly], [scenario.id])).toBe(computeScenarioDigest([scenario], [scenario.id]));
    const changed = { ...scenario, steps: [{ ...scenario.steps[0]!, url: "/different" }] };
    expect(computeScenarioDigest([changed], [scenario.id])).not.toBe(computeScenarioDigest([scenario], [scenario.id]));
  });
});
