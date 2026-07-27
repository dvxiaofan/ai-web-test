import { describe, expect, it } from "vitest";
import { findDuplicateProposals, findDuplicateScenarios } from "../../src/scenarios/deduplication.js";
import { importProposals } from "../../src/scenarios/importer.js";
import { buildTestInventory, buildValidProposal } from "../fixtures/inventory.js";

describe("findDuplicateScenarios", () => {
  it("groups identical scenarios by signature", () => {
    const inventory = buildTestInventory();
    const [scenario] = importProposals([buildValidProposal()], inventory).scenarios;
    const clone = { ...scenario };
    const groups = findDuplicateScenarios([scenario, clone]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it("ignores cosmetic differences like name and tags", () => {
    const inventory = buildTestInventory();
    const [scenario] = importProposals([buildValidProposal()], inventory).scenarios;
    const renamed = { ...scenario, name: "totally different name", tags: ["other"] };
    const groups = findDuplicateScenarios([scenario, renamed]);
    expect(groups).toHaveLength(1);
  });

  it("does not group scenarios with different roles", () => {
    const inventory = buildTestInventory();
    const [scenario] = importProposals([buildValidProposal()], inventory).scenarios;
    const different = { ...scenario, id: "other", roleIds: ["role-viewer"] };
    const groups = findDuplicateScenarios([scenario, different]);
    expect(groups).toEqual([]);
  });
});

describe("findDuplicateProposals", () => {
  it("groups identical proposals", () => {
    const a = buildValidProposal();
    const b = buildValidProposal();
    const groups = findDuplicateProposals([a, b]);
    expect(groups).toHaveLength(1);
  });

  it("does not group proposals with different steps", () => {
    const a = buildValidProposal();
    const b = buildValidProposal({ steps: [{ action: "wait" }] });
    const groups = findDuplicateProposals([a, b]);
    expect(groups).toEqual([]);
  });
});
