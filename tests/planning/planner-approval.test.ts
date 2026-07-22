import { describe, expect, it } from "vitest";

import { approvePlan, computePlanDigest, validateApprovedPlan } from "../../src/planning/approval.js";
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
});
