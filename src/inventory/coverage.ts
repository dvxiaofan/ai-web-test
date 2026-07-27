import type { Inventory, InventoryNode, TestScenario } from "../core/types.js";

/**
 * Phase 3 — coverage analysis that distinguishes *discovered* assets (from the
 * inventory) from *covered* assets (referenced by at least one scenario in the
 * catalog). This split is what lets the report show discovery coverage vs test
 * coverage, and what surfaces the modules/pages/routes with no test scenario.
 */

export interface CoverageDimension {
  name: "routes" | "pages" | "apis" | "modules" | "roles";
  discovered: number;
  covered: number;
  blocked: number;
  excluded: number;
}

export interface CoverageGap {
  kind: CoverageDimension["name"];
  id: string;
  name: string;
  reason: string;
}

export interface CoverageReport {
  project: string;
  inventoryId: string;
  dimensions: CoverageDimension[];
  gaps: CoverageGap[];
  summary: { discovered: number; covered: number; coverageRatio: number };
}

export function computeCoverage(inventory: Inventory, scenarios: readonly TestScenario[] = []): CoverageReport {
  const byKind = <K extends InventoryNode["kind"]>(kind: K): InventoryNode[] =>
    inventory.nodes.filter((node) => node.kind === kind);

  const routes = byKind("route");
  const pages = byKind("page");
  const apis = byKind("api");
  const modules = byKind("module");
  const roles = byKind("role");

  const scenarioRouteIds = new Set(scenarios.flatMap((scenario) => scenario.routeIds));
  const scenarioModuleIds = new Set(scenarios.flatMap((scenario) => scenario.moduleIds));
  const scenarioRoleIds = new Set(scenarios.flatMap((scenario) => scenario.roleIds));
  const scenarioApiIds = new Set(scenarios.flatMap((scenario) => scenario.operationIds));

  const routeToPage = new Map<string, string>();
  for (const route of routes) {
    if (route.kind === "route" && route.pageId) routeToPage.set(route.id, route.pageId);
  }
  const coveredPageIds = new Set(
    [...scenarioRouteIds].map((routeId) => routeToPage.get(routeId)).filter((value): value is string => Boolean(value)),
  );

  const dimensions: CoverageDimension[] = [
    buildDimension("routes", routes.length, countCovered(routes, scenarioRouteIds)),
    buildDimension("pages", pages.length, countCovered(pages, coveredPageIds)),
    buildDimension("apis", apis.length, countCovered(apis, scenarioApiIds)),
    buildDimension("modules", modules.length, countCovered(modules, scenarioModuleIds)),
    buildDimension("roles", roles.length, countCovered(roles, scenarioRoleIds)),
  ];

  const gaps: CoverageGap[] = collectGaps(dimensions, {
    routes,
    pages,
    apis,
    modules,
    roles,
  }, {
    routes: scenarioRouteIds,
    pages: coveredPageIds,
    apis: scenarioApiIds,
    modules: scenarioModuleIds,
    roles: scenarioRoleIds,
  });

  const discovered = dimensions.reduce((sum, dimension) => sum + dimension.discovered, 0);
  const covered = dimensions.reduce((sum, dimension) => sum + dimension.covered, 0);
  const coverageRatio = discovered === 0 ? 1 : covered / discovered;

  return {
    project: inventory.project.name,
    inventoryId: inventory.id,
    dimensions,
    gaps,
    summary: { discovered, covered, coverageRatio },
  };
}

function buildDimension(
  name: CoverageDimension["name"],
  discovered: number,
  covered: number,
): CoverageDimension {
  return { name, discovered, covered, blocked: 0, excluded: 0 };
}

function countCovered(nodes: InventoryNode[], coveredIds: Set<string>): number {
  return nodes.filter((node) => coveredIds.has(node.id)).length;
}

function collectGaps(
  dimensions: CoverageDimension[],
  nodeSets: Record<CoverageDimension["name"], InventoryNode[]>,
  coveredSets: Record<CoverageDimension["name"], Set<string>>,
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const dimension of dimensions) {
    if (dimension.discovered === 0) continue;
    for (const node of nodeSets[dimension.name]) {
      if (!coveredSets[dimension.name].has(node.id)) {
        gaps.push({
          kind: dimension.name,
          id: node.id,
          name: node.name,
          reason: `No scenario references this ${dimension.name.slice(0, -1)}.`,
        });
      }
    }
  }
  return gaps;
}
