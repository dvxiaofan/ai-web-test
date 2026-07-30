import type { ApiInventoryNode, Inventory, ModuleInventoryNode, RouteInventoryNode } from '../core/index.js';

/**
 * Comparison of two inventories of the same target.
 *
 * The primary use case is grading a black-box (`runtime-first`) discovery run
 * against a source-derived baseline: how much of the real surface did the
 * black-box pass actually recover?
 */
export interface InventoryDiff {
  base: InventorySurfaceSummary;
  compare: InventorySurfaceSummary;
  /** Present in base but missing from compare — the blind spots. */
  missing: { modules: string[]; routes: string[]; apis: string[] };
  /** Present in compare but absent from base — runtime-only discoveries. */
  extra: { modules: string[]; routes: string[]; apis: string[] };
  /** compare ∩ base ÷ base, rounded to 3 decimals; 1 when base is empty. */
  recall: { modules: number; routes: number; apis: number };
}

export interface InventorySurfaceSummary {
  id: string;
  discoveryMode: string;
  modules: number;
  routes: number;
  apis: number;
}

export function diffInventories(base: Inventory, compare: Inventory): InventoryDiff {
  const baseSurface = surfaceOf(base);
  const compareSurface = surfaceOf(compare);

  const diffSet = (from: Set<string>, to: Set<string>): string[] =>
    [...from].filter((item) => !to.has(item)).sort();

  const recallOf = (from: Set<string>, to: Set<string>): number => {
    if (from.size === 0) return 1;
    const hit = [...from].filter((item) => to.has(item)).length;
    return Math.round((hit / from.size) * 1000) / 1000;
  };

  return {
    base: {
      id: base.id,
      discoveryMode: discoveryModeOf(base),
      modules: baseSurface.modules.size,
      routes: baseSurface.routes.size,
      apis: baseSurface.apis.size,
    },
    compare: {
      id: compare.id,
      discoveryMode: discoveryModeOf(compare),
      modules: compareSurface.modules.size,
      routes: compareSurface.routes.size,
      apis: compareSurface.apis.size,
    },
    missing: {
      modules: diffSet(baseSurface.modules, compareSurface.modules),
      routes: diffSet(baseSurface.routes, compareSurface.routes),
      apis: diffSet(baseSurface.apis, compareSurface.apis),
    },
    extra: {
      modules: diffSet(compareSurface.modules, baseSurface.modules),
      routes: diffSet(compareSurface.routes, baseSurface.routes),
      apis: diffSet(compareSurface.apis, baseSurface.apis),
    },
    recall: {
      modules: recallOf(baseSurface.modules, compareSurface.modules),
      routes: recallOf(baseSurface.routes, compareSurface.routes),
      apis: recallOf(baseSurface.apis, compareSurface.apis),
    },
  };
}

/**
 * Compare by business identity (name / path / method+path) rather than node id:
 * ids are salted with the discovery origin and would never match across modes.
 */
function surfaceOf(inventory: Inventory): { modules: Set<string>; routes: Set<string>; apis: Set<string> } {
  const modules = new Set<string>();
  const routes = new Set<string>();
  const apis = new Set<string>();
  for (const node of inventory.nodes) {
    if (node.kind === 'module') modules.add((node as ModuleInventoryNode).name.toLowerCase());
    else if (node.kind === 'route') routes.add(normalizeRoutePath((node as RouteInventoryNode).path));
    else if (node.kind === 'api') {
      const api = node as ApiInventoryNode;
      apis.add(`${api.method.toUpperCase()} ${normalizeRoutePath(api.urlPattern)}`);
    }
  }
  return { modules, routes, apis };
}

function discoveryModeOf(inventory: Inventory): string {
  const mode = (inventory.metadata as { discoveryMode?: unknown } | undefined)?.discoveryMode;
  return typeof mode === 'string' ? mode : 'static';
}

/** Strip query strings and trailing slashes so the two modes compare fairly. */
function normalizeRoutePath(value: string): string {
  const withoutQuery = value.split('?')[0] ?? value;
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) return withoutQuery.slice(0, -1);
  return withoutQuery;
}
