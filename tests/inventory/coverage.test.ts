import { describe, expect, it } from "vitest";
import { computeCoverage } from "../../src/inventory/coverage.js";
import { importProposals } from "../../src/scenarios/importer.js";
import { buildTestInventory, buildValidProposal } from "../fixtures/inventory.js";

describe("computeCoverage", () => {
  it("reports discovered assets with no coverage when no scenarios exist", () => {
    const report = computeCoverage(buildTestInventory());
    expect(report.summary.discovered).toBe(6);
    expect(report.summary.covered).toBe(0);
    expect(report.summary.coverageRatio).toBe(0);
    const routes = report.dimensions.find((d) => d.name === "routes")!;
    const roles = report.dimensions.find((d) => d.name === "roles")!;
    expect(routes.discovered).toBe(1);
    expect(roles.discovered).toBe(2);
    expect(report.gaps).toHaveLength(6);
  });

  it("separates discovery coverage from test coverage", () => {
    const inventory = buildTestInventory();
    const [scenario] = importProposals([buildValidProposal()], inventory).scenarios;
    const report = computeCoverage(inventory, [scenario]);

    const routes = report.dimensions.find((d) => d.name === "routes")!;
    const pages = report.dimensions.find((d) => d.name === "pages")!;
    const modules = report.dimensions.find((d) => d.name === "modules")!;
    const roles = report.dimensions.find((d) => d.name === "roles")!;
    const apis = report.dimensions.find((d) => d.name === "apis")!;

    expect(routes.covered).toBe(1);
    expect(pages.covered).toBe(1);
    expect(modules.covered).toBe(1);
    expect(roles.covered).toBe(1);
    expect(apis.covered).toBe(0);

    const gapKinds = report.gaps.map((g) => g.kind);
    expect(gapKinds).not.toContain("routes");
    expect(gapKinds).toContain("apis");
    expect(gapKinds).toContain("roles");
  });
});
