import {
  stableId,
  type ApiInventoryNode,
  type EvidenceRef,
  type Finding,
  type Inventory,
  type InventoryNode,
  type ModuleInventoryNode,
  type PageInventoryNode,
  type RouteInventoryNode,
} from '../core/index.js';
import { inferRouteModule } from '../discovery/classify.js';
import type { BrowserExplorationResult, BrowserPageObservation, NetworkObservation, SkippedBrowserTarget } from '../browser/index.js';

export function mergeBrowserExploration(
  sourceInventory: Inventory,
  exploration: BrowserExplorationResult,
): Inventory {
  const nodes = sourceInventory.nodes.map(cloneNode);
  const findings = sourceInventory.findings.map((finding) => ({ ...finding, evidence: [...finding.evidence], relatedIds: [...finding.relatedIds] }));
  const now = exploration.endedAt;

  for (const page of exploration.pages) {
    const route = upsertRuntimeRoute(nodes, sourceInventory, page, now);
    upsertRuntimePage(nodes, route, page, now);
    for (const network of page.network) upsertRuntimeApi(nodes, sourceInventory, route, network, now);
    findings.push(...runtimeFindings(sourceInventory.id, route, page, now));
  }
  findings.push(...skippedTargetFindings(sourceInventory, exploration.skipped, now));

  const dedupedFindings = dedupeBy(findings, (finding) => finding.id);
  const routes = nodes.filter((node): node is RouteInventoryNode => node.kind === 'route');
  const pages = nodes.filter((node): node is PageInventoryNode => node.kind === 'page');
  const apis = nodes.filter((node): node is ApiInventoryNode => node.kind === 'api');

  return {
    ...sourceInventory,
    generatedAt: now,
    runtimeBaseUrl: exploration.baseUrl,
    nodes,
    findings: dedupedFindings,
    coverage: {
      ...sourceInventory.coverage,
      routes: {
        discovered: routes.length,
        visited: routes.filter((route) => route.evidence.some((evidence) => evidence.kind === 'runtime')).length,
        rendered: routes.filter((route) => route.evidence.some((evidence) => evidence.kind === 'runtime' && evidence.metadata?.rendered === true)).length,
      },
      pages: {
        discovered: pages.length,
        rendered: pages.filter((item) => item.evidence.some((evidence) => evidence.kind === 'runtime' && evidence.metadata?.rendered === true)).length,
        withScenario: pages.filter((item) => item.metadata?.withScenario === true).length,
      },
      apis: {
        discovered: apis.length,
        observed: apis.filter((api) => api.observed).length,
        asserted: apis.filter((api) => api.metadata?.asserted === true).length,
      },
      unresolved: dedupedFindings.filter((finding) => finding.status === 'open').length,
    },
    metadata: {
      ...(sourceInventory.metadata ?? {}),
      browserExplorationStatus: exploration.status,
      browserExplorationWarnings: exploration.warnings,
      browserPagesObserved: exploration.pages.length,
      browserSkippedTargets: exploration.skipped.map((target) => ({
        url: target.url,
        reason: target.reason,
        ...(target.detail === undefined ? {} : { detail: target.detail }),
      })),
    },
  };
}

function skippedTargetFindings(
  inventory: Inventory,
  skipped: readonly SkippedBrowserTarget[],
  now: string,
): Finding[] {
  const routes = inventory.nodes.filter((node): node is RouteInventoryNode => node.kind === 'route');
  return skipped.filter((target) => target.reason !== 'duplicate').map((target) => {
    const parsed = safeUrl(target.url, inventory.runtimeBaseUrl ?? inventory.project.baseUrl);
    const route = parsed === undefined
      ? undefined
      : routes.find((candidate) => pathsMatch(candidate.path, parsed.pathname));
    const reason = target.detail ? `${target.reason}: ${target.detail}` : target.reason;
    const id = stableId('finding', `${inventory.id}:coverage-gap:${target.url}:${target.reason}`);
    const evidence: EvidenceRef = {
      id: stableId('evidence', `${id}:${target.url}`),
      kind: 'runtime',
      summary: `Browser exploration did not cover ${target.url}`,
      confidence: 1,
      observedAt: now,
      uri: target.url,
      metadata: {
        reason: target.reason,
        ...(target.detail === undefined ? {} : { detail: target.detail }),
        ...(target.risk === undefined ? {} : { risk: target.risk }),
      },
    };
    return {
      id,
      category: 'coverage-gap',
      classification: 'coverage-gap',
      severity: target.reason === 'page-limit' || target.reason === 'dynamic-route' ? 'medium' : 'low',
      status: 'open',
      confidence: 1,
      title: `Browser coverage skipped: ${target.url}`,
      summary: reason,
      evidence: [evidence],
      relatedIds: route ? [route.id] : [],
      createdAt: now,
      fingerprint: id,
    } satisfies Finding;
  });
}

/**
 * Give a runtime-discovered route a module, creating the module node if this is
 * the first route to land in it.
 *
 * Without this, black-box discovery (`runtime-first`, or any target whose
 * routes are only found by the browser) produces an inventory with zero module
 * nodes. Scenarios generated from those routes then carry no `moduleIds`, and
 * the by-module report tree silently drops every executed scenario — a run that
 * passes but delivers no evidence. Module names come from the same
 * `inferRouteModule` heuristic the static path uses, so `/orders/42` groups
 * under `orders` whichever way it was discovered.
 */
function upsertRuntimeModule(nodes: InventoryNode[], routePath: string, now: string): ModuleInventoryNode {
  const name = inferRouteModule(routePath, 'root');
  const id = stableId('module', name);
  const existing = nodes.find((node): node is ModuleInventoryNode => node.kind === 'module' && node.id === id);
  if (existing) return existing;

  const module: ModuleInventoryNode = {
    id,
    kind: 'module',
    name,
    tags: ['runtime-discovered'],
    confidence: 0.6,
    evidence: [
      {
        id: stableId('evidence', 'runtime-module', id),
        kind: 'runtime',
        summary: `Module inferred from runtime-discovered route ${routePath}.`,
        confidence: 0.6,
        observedAt: now,
      },
    ],
    sourcePaths: [],
    routeIds: [],
    apiIds: [],
    metadata: { discoveredAtRuntime: true },
  };
  nodes.push(module);
  return module;
}

function upsertRuntimeRoute(
  nodes: InventoryNode[],
  inventory: Inventory,
  page: BrowserPageObservation,
  now: string,
): RouteInventoryNode {
  const url = safeUrl(page.finalUrl ?? page.requestedUrl, inventory.runtimeBaseUrl ?? inventory.project.baseUrl);
  const routePath = url?.pathname || page.requestedUrl;
  const existing = nodes.find(
    (node): node is RouteInventoryNode => node.kind === 'route' && pathsMatch(node.path, routePath),
  );
  const evidence = runtimePageEvidence(inventory.id, page, now);
  if (existing) {
    existing.evidence = dedupeBy([...existing.evidence, evidence], (item) => item.id);
    existing.confidence = Math.max(existing.confidence, page.rendered ? 1 : 0.8);
    return existing;
  }

  const module = upsertRuntimeModule(nodes, routePath, now);
  const route: RouteInventoryNode = {
    id: stableId('route', `${inventory.project.id}:${routePath}`),
    kind: 'route',
    name: page.title || routePath,
    path: routePath,
    moduleId: module.id,
    tags: ['runtime-discovered'],
    confidence: page.rendered ? 0.98 : 0.65,
    evidence: [evidence],
    requiresAuth: false,
    roleIds: [],
    metadata: { discoveredAtRuntime: true },
  };
  if (!module.routeIds.includes(route.id)) module.routeIds.push(route.id);
  nodes.push(route);
  return route;
}

function upsertRuntimePage(
  nodes: InventoryNode[],
  route: RouteInventoryNode,
  observation: BrowserPageObservation,
  now: string,
): PageInventoryNode {
  const existing = route.pageId
    ? nodes.find((node): node is PageInventoryNode => node.kind === 'page' && node.id === route.pageId)
    : nodes.find((node): node is PageInventoryNode => node.kind === 'page' && node.routePaths.some((item) => pathsMatch(item, route.path)));
  const evidence = runtimePageEvidence(route.id, observation, now);
  if (existing) {
    existing.evidence = dedupeBy([...existing.evidence, evidence], (item) => item.id);
    existing.confidence = Math.max(existing.confidence, observation.rendered ? 1 : 0.75);
    existing.metadata = {
      ...(existing.metadata ?? {}),
      rendered: observation.rendered,
      controls: observation.controls.length,
      links: observation.links.length,
      controlSummaries: observation.controls.slice(0, 100).map((control) => ({
        text: control.text,
        type: control.type ?? control.tagName,
        risk: control.risk,
      })),
      linkSummaries: observation.links.slice(0, 100).map((link) => ({
        text: link.text,
        url: link.url,
        risk: link.risk,
      })),
    };
    route.pageId = existing.id;
    return existing;
  }

  const page: PageInventoryNode = {
    id: stableId('page', route.id),
    kind: 'page',
    name: observation.title || route.name,
    ...(route.moduleId ? { moduleId: route.moduleId } : {}),
    tags: ['runtime-observed'],
    confidence: observation.rendered ? 1 : 0.7,
    evidence: [evidence],
    routePaths: [route.path],
    componentIds: [],
    operationIds: [],
    metadata: {
      rendered: observation.rendered,
      controls: observation.controls.length,
      links: observation.links.length,
      controlSummaries: observation.controls.slice(0, 100).map((control) => ({
        text: control.text,
        type: control.type ?? control.tagName,
        risk: control.risk,
      })),
      linkSummaries: observation.links.slice(0, 100).map((link) => ({
        text: link.text,
        url: link.url,
        risk: link.risk,
      })),
    },
  };
  route.pageId = page.id;
  nodes.push(page);
  return page;
}

function upsertRuntimeApi(
  nodes: InventoryNode[],
  inventory: Inventory,
  route: RouteInventoryNode,
  observation: NetworkObservation,
  now: string,
): void {
  if (!['xhr', 'fetch'].includes(observation.resourceType)) return;
  const url = safeUrl(observation.url, inventory.project.baseUrl);
  if (!url) return;
  const urlPattern = `${url.pathname}${url.search}`;
  const existing = nodes.find(
    (node): node is ApiInventoryNode =>
      node.kind === 'api' && node.method.toUpperCase() === observation.method.toUpperCase() && apiPathsMatch(node.urlPattern, url.pathname),
  );
  const evidence: EvidenceRef = {
    id: stableId('evidence', `${route.id}:${observation.method}:${urlPattern}:${observation.status ?? 'failed'}`),
    kind: 'runtime',
    summary: `${observation.method} ${urlPattern} observed while visiting ${route.path}`,
    confidence: 1,
    observedAt: now,
    uri: observation.url,
    metadata: {
      status: observation.status ?? null,
      ok: observation.ok ?? false,
      blocked: observation.blocked,
      routeId: route.id,
    },
  };
  if (existing) {
    existing.observed = true;
    existing.evidence = dedupeBy([...existing.evidence, evidence], (item) => item.id);
    existing.confidence = Math.max(existing.confidence, 1);
    return;
  }

  nodes.push({
    id: stableId('api', `${inventory.project.id}:${observation.method}:${url.pathname}`),
    kind: 'api',
    name: `${observation.method.toUpperCase()} ${url.pathname}`,
    ...(route.moduleId ? { moduleId: route.moduleId } : {}),
    tags: ['runtime-observed'],
    confidence: 1,
    evidence: [evidence],
    method: observation.method.toUpperCase(),
    urlPattern: url.pathname,
    observed: true,
    metadata: { discoveredAtRuntime: true },
  });
}

function runtimeFindings(
  inventoryId: string,
  route: RouteInventoryNode,
  page: BrowserPageObservation,
  now: string,
): Finding[] {
  const findings: Finding[] = [];
  if (!page.rendered || page.error) {
    findings.push(buildFinding(inventoryId, route, now, 'defect', 'high', `Page failed to render: ${route.path}`, page.error ?? 'Page did not render.', page));
  }
  if (page.httpStatus !== undefined && page.httpStatus >= 400) {
    findings.push(buildFinding(inventoryId, route, now, 'defect', page.httpStatus >= 500 ? 'high' : 'medium', `HTTP ${page.httpStatus} on ${route.path}`, `Navigation returned HTTP ${page.httpStatus}.`, page));
  }
  for (const error of page.pageErrors) {
    findings.push(buildFinding(inventoryId, route, now, 'defect', 'high', `Page error on ${route.path}`, `${error.name}: ${error.message}`, page));
  }
  for (const event of page.console.filter((item) => item.type === 'error')) {
    findings.push(buildFinding(inventoryId, route, now, 'defect', 'medium', `Console error on ${route.path}`, event.text, page));
  }
  for (const request of page.network.filter((item) => item.failure || (item.status !== undefined && item.status >= 400))) {
    findings.push(buildFinding(inventoryId, route, now, 'environment', 'medium', `Request failed on ${route.path}`, `${request.method} ${request.url}: ${request.failure ?? request.status}`, page));
  }
  for (const issue of page.visualIssues) {
    findings.push(buildFinding(
      inventoryId,
      route,
      now,
      'visual',
      issue.severity,
      `Visual issue on ${route.path}: ${issue.kind}`,
      `${issue.message}${issue.selector ? ` Selector: ${issue.selector}.` : ''}`,
      page,
    ));
  }
  for (const issue of page.accessibilityIssues) {
    findings.push(buildFinding(
      inventoryId,
      route,
      now,
      'accessibility',
      issue.severity,
      `Accessibility issue on ${route.path}: ${issue.rule}`,
      `${issue.message}${issue.selector ? ` Selector: ${issue.selector}.` : ''}`,
      page,
    ));
  }
  return findings;
}

function buildFinding(
  inventoryId: string,
  route: RouteInventoryNode,
  now: string,
  category: Finding['category'],
  severity: Finding['severity'],
  title: string,
  summary: string,
  page: BrowserPageObservation,
): Finding {
  const id = stableId('finding', `${inventoryId}:${route.id}:${title}:${summary}`);
  return {
    id,
    category,
    classification: category === 'environment' ? 'environment-failure' : 'probable-defect',
    severity,
    status: 'open',
    confidence: 0.9,
    title,
    summary,
    evidence: [runtimePageEvidence(id, page, now)],
    relatedIds: [route.id],
    createdAt: now,
    fingerprint: id,
  };
}

function runtimePageEvidence(parentId: string, page: BrowserPageObservation, now: string): EvidenceRef {
  return {
    id: stableId('evidence', `${parentId}:${page.requestedUrl}:${page.durationMs}:${page.rendered}`),
    kind: 'runtime',
    summary: `Observed ${page.finalUrl ?? page.requestedUrl} in a real browser`,
    confidence: 1,
    observedAt: now,
    uri: page.finalUrl ?? page.requestedUrl,
    ...(page.screenshotPath ? { artifactPath: page.screenshotPath } : {}),
    metadata: {
      rendered: page.rendered,
      status: page.httpStatus ?? null,
      title: page.title ?? '',
      consoleErrors: page.console.filter((item) => item.type === 'error').length,
      pageErrors: page.pageErrors.length,
      networkFailures: page.network.filter((item) => item.failure || (item.status !== undefined && item.status >= 400)).length,
      visualIssues: page.visualIssues.length,
      accessibilityIssues: page.accessibilityIssues.length,
    },
  };
}

function cloneNode<T extends InventoryNode>(node: T): T {
  return {
    ...node,
    tags: [...node.tags],
    evidence: node.evidence.map((item) => ({ ...item, ...(item.metadata ? { metadata: { ...item.metadata } } : {}) })),
    ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
  };
}

function pathsMatch(left: string, right: string): boolean {
  const normalize = (value: string) => (value !== '/' ? value.replace(/\/$/, '') : value);
  const pattern = normalize(left)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[[^/]+\\\]/g, '[^/]+')
    .replace(/:[^/]+/g, '[^/]+')
    .replace(/\*/g, '.*');
  return new RegExp(`^${pattern}$`).test(normalize(right));
}

function apiPathsMatch(pattern: string, observed: string): boolean {
  return pathsMatch(pattern.split('?')[0] ?? pattern, observed);
}

function safeUrl(value: string, baseUrl?: string): URL | undefined {
  try {
    return new URL(value, baseUrl);
  } catch {
    return undefined;
  }
}

function dedupeBy<T>(values: T[], getKey: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [getKey(value), value])).values()];
}
