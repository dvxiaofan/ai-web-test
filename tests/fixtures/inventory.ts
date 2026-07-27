import type { Inventory, ScenarioProposal } from "../../src/core/types.js";
import { createProposal } from "../../src/scenarios/proposal.js";

/** A small but complete inventory used across Phase 3 tests. */
export function buildTestInventory(): Inventory {
  const now = new Date().toISOString();
  const inventory = {
    id: "inv-test",
    name: "Test Inventory",
    project: { name: "test-app", baseUrl: "https://app.example.com" },
    nodes: [
      {
        id: "mod-users",
        kind: "module",
        name: "User Module",
        routeIds: ["r-users-list"],
        apiIds: ["api-list-users"],
        evidence: [],
      },
      {
        id: "r-users-list",
        kind: "route",
        name: "GET /users",
        method: "GET",
        path: "/users",
        pageId: "pg-users",
        evidence: [],
      },
      {
        id: "pg-users",
        kind: "page",
        name: "Users Page",
        routePaths: ["/users"],
        componentIds: [],
        operationIds: ["api-list-users"],
        evidence: [],
      },
      {
        id: "api-list-users",
        kind: "api",
        name: "GET /api/users",
        method: "GET",
        urlPattern: "/api/users",
        evidence: [],
      },
      { id: "role-admin", kind: "role", name: "Admin", evidence: [] },
      { id: "role-viewer", kind: "role", name: "Viewer", evidence: [] },
    ],
    edges: [
      { from: "api-list-users", to: "pg-users", type: "consumes" },
      { from: "pg-users", to: "mod-users", type: "belongs-to" },
    ],
    coverage: {
      generatedAt: now,
      routesDiscovered: 1,
      pagesReached: 1,
      apisObserved: 1,
      rolePages: 2,
      pageScenarios: 0,
      byModule: [],
    },
    findings: [],
    metadata: {},
  };
  return inventory as unknown as Inventory;
}

export function buildValidProposal(overrides: Partial<Parameters<typeof createProposal>[0]> = {}): ScenarioProposal {
  return createProposal({
    name: "View users list",
    source: "ai",
    risk: "read",
    routeId: "r-users-list",
    pageId: "pg-users",
    moduleId: "mod-users",
    roleIds: ["role-admin"],
    tags: ["smoke"],
    expectedOutcome: "Users table is visible",
    steps: [
      { action: "navigate", url: "https://app.example.com/users" },
      { action: "screenshot" },
    ],
    evidence: [{ type: "route", value: "r-users-list" }],
    ...overrides,
  });
}
