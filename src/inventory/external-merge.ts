import {
  stableId,
  type ApiInventoryNode,
  type ApiMethod,
  type EvidenceRef,
  type Inventory,
  type InventoryNode,
  type ModuleInventoryNode,
  type RouteInventoryNode,
} from '../core/index.js';

/**
 * Structured inventory supplement authored by a human operator or an AI agent.
 *
 * Black-box (runtime-first) discovery cannot reach deep-linked routes or APIs
 * that were never triggered during exploration. This input is the sanctioned
 * channel to top the inventory up without hand-editing `inventory.json`.
 */
export interface ExternalInventoryInput {
  modules?: ExternalModuleInput[];
  routes?: ExternalRouteInput[];
  apis?: ExternalApiInput[];
  /** Free-form note recorded on every produced evidence entry. */
  note?: string;
  /** Provenance of the supplement; defaults to `ai`. */
  source?: 'ai' | 'operator';
}

export interface ExternalModuleInput {
  name: string;
  description?: string;
  /** Route paths belonging to this module; created if missing. */
  routes?: string[];
  /** APIs belonging to this module; created if missing. */
  apis?: ExternalApiInput[];
}

export interface ExternalRouteInput {
  path: string;
  name?: string;
  /** Module name (not id); the module is created when unknown. */
  module?: string;
  requiresAuth?: boolean;
  description?: string;
}

export interface ExternalApiInput {
  method: string;
  path: string;
  name?: string;
  module?: string;
  description?: string;
}

export interface ExternalMergeResult {
  inventory: Inventory;
  /** Nodes created, per kind. */
  added: { modules: number; routes: number; apis: number };
  /** Existing nodes enriched instead of duplicated. */
  updated: { modules: number; routes: number; apis: number };
  /** Entries rejected by validation; merge never fails as a whole. */
  warnings: string[];
}

const API_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Merge an external supplement into an inventory.
 *
 * Invalid entries are skipped and reported through `warnings` rather than
 * aborting the whole merge, so one bad row cannot discard a good batch.
 */
export function mergeExternalInventory(
  sourceInventory: Inventory,
  input: ExternalInventoryInput,
): ExternalMergeResult {
  const now = new Date().toISOString();
  const evidenceKind = input.source === 'operator' ? 'operator' : 'ai';
  const nodes: InventoryNode[] = sourceInventory.nodes.map((node) => ({
    ...node,
    tags: [...node.tags],
    evidence: [...node.evidence],
  }));
  const warnings: string[] = [];
  const added = { modules: 0, routes: 0, apis: 0 };
  const updated = { modules: 0, routes: 0, apis: 0 };

  const makeEvidence = (subject: string): EvidenceRef => ({
    id: stableId('evidence', `external:${evidenceKind}:${subject}`),
    kind: evidenceKind,
    summary: input.note
      ? `${subject} supplied via inventory merge — ${input.note}`
      : `${subject} supplied via inventory merge`,
    confidence: 0.6,
    observedAt: now,
  });

  const findModuleByName = (name: string): ModuleInventoryNode | undefined =>
    nodes.find(
      (node): node is ModuleInventoryNode =>
        node.kind === 'module' && node.name.toLowerCase() === name.toLowerCase(),
    );

  const upsertModule = (name: string, description?: string): ModuleInventoryNode => {
    const existing = findModuleByName(name);
    if (existing) {
      if (description && !existing.description) existing.description = description;
      existing.evidence = dedupeById([...existing.evidence, makeEvidence(`module ${name}`)]);
      if (!existing.tags.includes('externally-supplied')) existing.tags.push('externally-supplied');
      updated.modules += 1;
      return existing;
    }
    const module: ModuleInventoryNode = {
      id: stableId('module', `${sourceInventory.project.id}:${name}`),
      kind: 'module',
      name,
      ...(description ? { description } : {}),
      tags: ['externally-supplied'],
      confidence: 0.6,
      evidence: [makeEvidence(`module ${name}`)],
      sourcePaths: [],
      routeIds: [],
      apiIds: [],
    };
    nodes.push(module);
    added.modules += 1;
    return module;
  };

  const upsertRoute = (entry: ExternalRouteInput, module?: ModuleInventoryNode): void => {
    const routePath = normalizePath(entry.path);
    if (!routePath) {
      warnings.push(`route skipped: invalid path ${JSON.stringify(entry.path)}`);
      return;
    }
    const existing = nodes.find(
      (node): node is RouteInventoryNode => node.kind === 'route' && node.path === routePath,
    );
    if (existing) {
      existing.evidence = dedupeById([...existing.evidence, makeEvidence(`route ${routePath}`)]);
      if (module && !existing.moduleId) existing.moduleId = module.id;
      if (entry.description && !existing.description) existing.description = entry.description;
      updated.routes += 1;
      if (module && !module.routeIds.includes(existing.id)) module.routeIds.push(existing.id);
      return;
    }
    const route: RouteInventoryNode = {
      id: stableId('route', `${sourceInventory.project.id}:${routePath}`),
      kind: 'route',
      name: entry.name ?? routePath,
      ...(entry.description ? { description: entry.description } : {}),
      ...(module ? { moduleId: module.id } : {}),
      path: routePath,
      tags: ['externally-supplied'],
      confidence: 0.6,
      evidence: [makeEvidence(`route ${routePath}`)],
      requiresAuth: entry.requiresAuth ?? false,
      roleIds: [],
    };
    nodes.push(route);
    added.routes += 1;
    if (module) module.routeIds.push(route.id);
  };

  const upsertApi = (entry: ExternalApiInput, module?: ModuleInventoryNode): void => {
    const method = String(entry.method ?? '').toUpperCase();
    const apiPath = normalizePath(entry.path);
    if (!API_METHODS.includes(method)) {
      warnings.push(`api skipped: unsupported method ${JSON.stringify(entry.method)} for ${entry.path}`);
      return;
    }
    if (!apiPath) {
      warnings.push(`api skipped: invalid path ${JSON.stringify(entry.path)}`);
      return;
    }
    const existing = nodes.find(
      (node): node is ApiInventoryNode =>
        node.kind === 'api' && node.method.toUpperCase() === method && node.urlPattern === apiPath,
    );
    if (existing) {
      existing.evidence = dedupeById([...existing.evidence, makeEvidence(`api ${method} ${apiPath}`)]);
      if (module && !existing.moduleId) existing.moduleId = module.id;
      updated.apis += 1;
      if (module && !module.apiIds.includes(existing.id)) module.apiIds.push(existing.id);
      return;
    }
    const api: ApiInventoryNode = {
      id: stableId('api', `${sourceInventory.project.id}:${method}:${apiPath}`),
      kind: 'api',
      name: entry.name ?? `${method} ${apiPath}`,
      ...(entry.description ? { description: entry.description } : {}),
      ...(module ? { moduleId: module.id } : {}),
      method: method as ApiMethod,
      urlPattern: apiPath,
      tags: ['externally-supplied'],
      confidence: 0.6,
      evidence: [makeEvidence(`api ${method} ${apiPath}`)],
      observed: false,
    };
    nodes.push(api);
    added.apis += 1;
    if (module) module.apiIds.push(api.id);
  };

  for (const entry of input.modules ?? []) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      warnings.push('module skipped: missing name');
      continue;
    }
    const module = upsertModule(entry.name.trim(), entry.description);
    for (const routePath of entry.routes ?? []) upsertRoute({ path: routePath }, module);
    for (const api of entry.apis ?? []) upsertApi(api, module);
  }

  for (const entry of input.routes ?? []) {
    if (!entry || typeof entry.path !== 'string') {
      warnings.push('route skipped: missing path');
      continue;
    }
    const module = entry.module ? upsertModule(entry.module) : undefined;
    upsertRoute(entry, module);
  }

  for (const entry of input.apis ?? []) {
    if (!entry || typeof entry.path !== 'string') {
      warnings.push('api skipped: missing path');
      continue;
    }
    const module = entry.module ? upsertModule(entry.module) : undefined;
    upsertApi(entry, module);
  }

  const routes = nodes.filter((node): node is RouteInventoryNode => node.kind === 'route');
  const apis = nodes.filter((node): node is ApiInventoryNode => node.kind === 'api');

  const inventory: Inventory = {
    ...sourceInventory,
    nodes,
    coverage: {
      ...sourceInventory.coverage,
      routes: { ...sourceInventory.coverage.routes, discovered: routes.length },
      apis: {
        ...sourceInventory.coverage.apis,
        discovered: apis.length,
        observed: apis.filter((api) => api.observed).length,
      },
    },
    metadata: {
      ...(sourceInventory.metadata ?? {}),
      externalMergeAt: now,
      externalMergeSource: evidenceKind,
    },
  };

  return { inventory, added, updated, warnings };
}

function normalizePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      return undefined;
    }
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function dedupeById(items: EvidenceRef[]): EvidenceRef[] {
  const seen = new Map<string, EvidenceRef>();
  for (const item of items) seen.set(item.id, item);
  return [...seen.values()];
}
