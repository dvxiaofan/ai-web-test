import { describe, expect, it } from "vitest";
import { queryInventory } from "../../src/inventory/queries.js";
import { importProposals } from "../../src/scenarios/importer.js";
import { buildTestInventory, buildValidProposal } from "../fixtures/inventory.js";

const inventory = buildTestInventory();

describe("queryInventory", () => {
  it("summary returns coverage dimensions", () => {
    const result = queryInventory({ action: "summary" }, inventory) as {
      coverage: { dimensions: unknown[] };
    };
    expect(result.coverage.dimensions).toHaveLength(5);
  });

  it("modules lists module nodes with their routes/apis", () => {
    const result = queryInventory({ action: "modules" }, inventory) as {
      modules: Array<{ id: string; routeIds: string[] }>;
    };
    expect(result.modules[0]!.id).toBe("mod-users");
    expect(result.modules[0]!.routeIds).toContain("r-users-list");
  });

  it("module returns a single node by id", () => {
    const result = queryInventory({ action: "module", id: "mod-users" }, inventory) as { id: string };
    expect(result.id).toBe("mod-users");
  });

  it("module throws for an unknown id", () => {
    expect(() => queryInventory({ action: "module", id: "ghost" }, inventory)).toThrow();
  });

  it("page returns a single page node", () => {
    const result = queryInventory({ action: "page", id: "pg-users" }, inventory) as { id: string };
    expect(result.id).toBe("pg-users");
  });

  it("relationships returns the edge list", () => {
    const result = queryInventory({ action: "relationships" }, inventory) as { edges: unknown[] };
    expect(result.edges).toHaveLength(2);
  });

  it("gaps reflects current scenario coverage", () => {
    const scenario = importProposals([buildValidProposal()], inventory).scenarios[0]!;
    const result = queryInventory({ action: "gaps", scenarios: [scenario] }, inventory) as {
      gaps: Array<{ kind: string }>;
    };
    const kinds = result.gaps.map((g) => g.kind);
    expect(kinds).not.toContain("routes");
    expect(kinds).toContain("apis");
  });
});
