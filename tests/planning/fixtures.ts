import { createDefaultPolicy } from "../../src/core/policy.js";
import type {
  EvidenceRef,
  Inventory,
  InventoryEdge,
  TestScenario,
} from "../../src/core/types.js";

export const evidence: EvidenceRef[] = [
  { id: "e-fixture", kind: "source", summary: "fixture", confidence: 1 },
];

export function makeScenario(
  id: string,
  moduleId: string,
  options: Partial<Pick<TestScenario, "routeIds" | "roleIds" | "tags" | "risk" | "prerequisites">> = {},
): TestScenario {
  return {
    schemaVersion: 1,
    id,
    name: id,
    source: "user",
    confidence: 1,
    moduleIds: [moduleId],
    routeIds: options.routeIds ?? [`route-${moduleId}`],
    operationIds: [],
    roleIds: options.roleIds ?? [],
    tags: options.tags ?? [],
    risk: options.risk ?? "read",
    steps: [
      {
        id: `${id}-navigate`,
        action: "navigate",
        url: "/",
        risk: "read",
      },
    ],
    ...(options.prerequisites === undefined ? {} : { prerequisites: options.prerequisites }),
    evidence,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makeInventory(edges: InventoryEdge[] = []): Inventory {
  return {
    schemaVersion: 1,
    id: "inventory-fixture",
    project: { id: "project-fixture", name: "fixture", rootDir: "/tmp/fixture", baseUrl: "http://app.test:3000" },
    generatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      {
        id: "module-orders",
        kind: "module",
        name: "Orders",
        sourcePaths: ["src/orders"],
        routeIds: ["route-orders"],
        apiIds: [],
        tags: ["orders"],
        confidence: 1,
        evidence,
      },
      {
        id: "module-auth",
        kind: "module",
        name: "Auth",
        sourcePaths: ["src/auth"],
        routeIds: ["route-auth"],
        apiIds: [],
        tags: ["auth"],
        confidence: 1,
        evidence,
      },
      {
        id: "route-orders",
        kind: "route",
        name: "Orders",
        path: "/orders",
        requiresAuth: true,
        roleIds: ["role-user"],
        moduleId: "module-orders",
        tags: ["orders"],
        confidence: 1,
        evidence,
      },
      {
        id: "route-auth",
        kind: "route",
        name: "Login",
        path: "/login",
        requiresAuth: false,
        roleIds: [],
        moduleId: "module-auth",
        tags: ["auth"],
        confidence: 1,
        evidence,
      },
      {
        id: "role-user",
        kind: "role",
        name: "User",
        roleKey: "user",
        permissions: [],
        authenticated: true,
        tags: ["user"],
        confidence: 1,
        evidence,
      },
      {
        id: "node-scenario-order",
        kind: "scenario",
        scenarioId: "scenario-order",
        name: "Create order",
        routeIds: ["route-orders"],
        operationIds: [],
        roleIds: ["role-user"],
        risk: "read",
        moduleId: "module-orders",
        tags: ["orders"],
        confidence: 1,
        evidence,
      },
      {
        id: "node-scenario-login",
        kind: "scenario",
        scenarioId: "scenario-login",
        name: "Login",
        routeIds: ["route-auth"],
        operationIds: [],
        roleIds: [],
        risk: "read",
        moduleId: "module-auth",
        tags: ["smoke"],
        confidence: 1,
        evidence,
      },
    ],
    edges,
    findings: [],
    coverage: {
      routes: { discovered: 2, visited: 0, rendered: 0 },
      pages: { discovered: 2, rendered: 0, withScenario: 0 },
      apis: { discovered: 0, observed: 0, asserted: 0 },
      roles: { configured: 1, exercised: 0 },
      scenarios: { discovered: 2, proposed: 0, approved: 0 },
      unresolved: 0,
    },
  };
}

export function makePolicy() {
  return createDefaultPolicy("http://app.test:3000");
}
