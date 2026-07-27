import { describe, expect, it } from "vitest";
import { validateProposalShape } from "../../src/scenarios/proposal-schema.js";
import { buildValidProposal } from "../fixtures/inventory.js";

describe("validateProposalShape", () => {
  it("accepts a well-formed proposal", () => {
    const result = validateProposalShape(buildValidProposal());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a non-object", () => {
    const result = validateProposalShape(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports every missing required field", () => {
    const result = validateProposalShape({});
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("name");
    expect(result.errors.join(" ")).toContain("risk");
  });

  it("rejects an unknown risk", () => {
    const proposal = buildValidProposal();
    // @ts-expect-error intentionally invalid risk
    proposal.risk = "explode";
    const result = validateProposalShape(proposal);
    expect(result.valid).toBe(false);
  });

  it("rejects malformed steps", () => {
    const proposal = buildValidProposal();
    // @ts-expect-error intentionally invalid step
    proposal.steps = [{ action: 42 }];
    const result = validateProposalShape(proposal);
    expect(result.valid).toBe(false);
  });
});
