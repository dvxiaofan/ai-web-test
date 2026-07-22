import {
  stableId,
  type EvidenceRef,
  type Inventory,
  type RouteInventoryNode,
  type TestScenario,
} from '../core/index.js';

export interface GenerateSmokeScenariosOptions {
  includeDynamicRoutes?: boolean;
  screenshot?: boolean;
}

/**
 * Produce conservative read-only smoke scenarios from discovered routes.
 * These scenarios verify reachability and rendering; they do not pretend to
 * cover business rules that discovery has not established.
 */
export function generateRouteSmokeScenarios(
  inventory: Inventory,
  options: GenerateSmokeScenariosOptions = {},
): TestScenario[] {
  const routes = inventory.nodes.filter((node): node is RouteInventoryNode => node.kind === 'route');
  return routes
    .filter((route) => options.includeDynamicRoutes || !isDynamicPath(route.path))
    .map((route) => buildRouteScenario(inventory, route, options));
}

function buildRouteScenario(
  inventory: Inventory,
  route: RouteInventoryNode,
  options: GenerateSmokeScenariosOptions,
): TestScenario {
  const id = stableId('scenario', `${inventory.project.id}:route-smoke:${route.path}`);
  const evidence: EvidenceRef[] = route.evidence.map((item) => ({ ...item }));
  const steps: TestScenario['steps'] = [
    {
      id: stableId('step', `${id}:navigate`),
      name: `Navigate to ${route.path}`,
      action: 'navigate',
      risk: 'read',
      url: route.path,
      waitUntil: 'domcontentloaded',
    },
    {
      id: stableId('step', `${id}:url`),
      name: 'Confirm the intended route rendered',
      action: 'assert',
      risk: 'read',
      assertion: 'url',
      expected: normalizedExpectedPath(route.path),
      comparator: 'contains',
    },
    {
      id: stableId('step', `${id}:body`),
      name: 'Confirm the page body is visible',
      action: 'assert',
      risk: 'read',
      assertion: 'visible',
      locator: { strategy: 'css', value: 'body' },
    },
  ];
  if (options.screenshot !== false) {
    steps.push({
      id: stableId('step', `${id}:screenshot`),
      name: `route-${sanitizeName(route.path)}`,
      action: 'screenshot',
      risk: 'read',
      fullPage: true,
      baselineKey: `route:${route.path}`,
    });
  }

  return {
    schemaVersion: 1,
    id,
    name: `Smoke: ${route.name || route.path}`,
    description: `Read-only reachability and rendering check generated for ${route.path}.`,
    source: 'generated',
    confidence: Math.min(route.confidence, 0.9),
    moduleIds: route.moduleId ? [route.moduleId] : [],
    routeIds: [route.id],
    operationIds: [],
    roleIds: route.roleIds,
    tags: ['smoke', 'generated', ...(route.requiresAuth ? ['authenticated'] : [])],
    risk: 'read',
    steps,
    evidence,
    createdAt: new Date().toISOString(),
    metadata: { generatedBy: 'route-smoke-generator', routePath: route.path },
  };
}

function isDynamicPath(routePath: string): boolean {
  return /[:*\[\]{}]/.test(routePath);
}

function normalizedExpectedPath(routePath: string): string {
  return routePath === '/' ? '/' : routePath.replace(/\/$/, '');
}

function sanitizeName(routePath: string): string {
  return routePath.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '-') || 'home';
}
