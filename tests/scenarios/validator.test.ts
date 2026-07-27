import { describe, expect, it } from "vitest";
import type { TestScenario } from "../../src/core/types.js";
import { validateProposal } from "../../src/scenarios/validator.js";
import { buildTestInventory, buildValidProposal } from "../fixtures/inventory.js";

function duplicateScenario(): TestScenario {
  return {
    schemaVersion: 1,
    id: "s-duplicate",
    name: "existing users scenario",
    source: "generated",
    confidence: 0.8,
    moduleIds: ["mod-users"],
    routeIds: ["r-users-list"],
    operationIds: [],
    roleIds: ["role-admin"],
    tags: [],
    risk: "read",
    steps: [
      { id: "step-1", risk: "read", action: "navigate", url: "https://app.example.com/users" },
      { id: "step-2", risk: "read", action: "screenshot" },
    ],
    evidence: [],
    createdAt: new Date().toISOString(),
  };
}

describe("validateProposal", () => {
  it("accepts a proposal whose references resolve in the inventory", () => {
    const result = validateProposal(buildValidProposal(), { inventory: buildTestInventory() });
    expect(result.status).toBe("accepted");
    expect(result.errors).toEqual([]);
  });

  it("rejects a proposal that references an unknown route", () => {
    const result = validateProposal(buildValidProposal({ routeId: "ghost-route" }), {
      inventory: buildTestInventory(),
    });
    expect(result.status).toBe("rejected");
    expect(result.errors.join(" ")).toContain("ghost-route");
  });

  it("rejects a proposal that references an unknown role", () => {
    const result = validateProposal(buildValidProposal({ roleIds: ["ghost-role"] }), {
      inventory: buildTestInventory(),
    });
    expect(result.status).toBe("rejected");
    expect(result.errors.join(" ")).toContain("ghost-role");
  });

  it("rejects when the risk exceeds maxRisk", () => {
    const result = validateProposal(buildValidProposal({ risk: "mutate" }), {
      inventory: buildTestInventory(),
      maxRisk: "read",
    });
    expect(result.status).toBe("rejected");
  });

  it("rejects a proposal that duplicates an existing scenario", () => {
    const result = validateProposal(buildValidProposal(), {
      inventory: buildTestInventory(),
      existingScenarios: [duplicateScenario()],
    });
    expect(result.status).toBe("rejected");
    expect(result.duplicateOf).toBe("s-duplicate");
  });

  it("rejects duplicate proposals within the same batch", () => {
    const a = buildValidProposal();
    const b = buildValidProposal();
    const result = validateProposal(b, {
      inventory: buildTestInventory(),
      otherProposals: [a, b],
    });
    expect(result.status).toBe("rejected");
    expect(result.duplicateOf).toBe(a.id);
  });
});
