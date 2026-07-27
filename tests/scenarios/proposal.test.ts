import { describe, expect, it } from "vitest";
import { createProposal, proposeScenario } from "../../src/scenarios/proposal.js";
import { buildValidProposal, buildTestInventory } from "../fixtures/inventory.js";

describe("createProposal", () => {
  it("produces a pending proposal with stable, content-addressed id", () => {
    const a = buildValidProposal();
    const b = buildValidProposal();
    expect(a.status).toBe("pending");
    expect(a.id).toBe(b.id);
    expect(a.schemaVersion).toBe(1);
  });

  it("does not mutate the input steps/evidence arrays", () => {
    const input = {
      name: "x",
      source: "ai" as const,
      risk: "read" as const,
      steps: [{ action: "wait" }],
      evidence: [{ type: "observation" as const, value: "ok" }],
    };
    const proposal = createProposal(input);
    expect(proposal.steps).not.toBe(input.steps);
    expect(proposal.evidence).not.toBe(input.evidence);
  });

  it("rejects an invalid createdAt", () => {
    expect(() => createProposal({ name: "x", source: "ai", risk: "read", steps: [], createdAt: "nope" })).toThrow(
      TypeError,
    );
  });

  it("exposes proposeScenario as an alias", () => {
    expect(proposeScenario).toBe(createProposal);
  });

  it("validates references against the inventory when paired with the validator", () => {
    const inventory = buildTestInventory();
    const proposal = buildValidProposal({ routeId: "missing" });
    expect(inventory.nodes.some((n) => n.id === proposal.routeId)).toBe(false);
  });
});
