import { describe, expect, it } from 'vitest';

import type { ApiInventoryNode, Inventory, ModuleInventoryNode, RouteInventoryNode } from '../../src/core/types.js';
import { mergeExternalInventory } from '../../src/inventory/external-merge.js';
import { diffInventories } from '../../src/inventory/diff.js';

function baseInventory(): Inventory {
  return {
    schemaVersion: 1,
    id: 'inv-1',
    project: { id: 'p1', name: 'shop', rootDir: '/tmp/app', baseUrl: 'http://localhost:4178' },
    generatedAt: '2026-07-30T00:00:00.000Z',
    nodes: [
      {
        id: 'm-order',
        kind: 'module',
        name: '订单',
        tags: [],
        confidence: 1,
        evidence: [],
        sourcePaths: [],
        routeIds: ['r-orders'],
        apiIds: [],
      },
      {
        id: 'r-orders',
        kind: 'route',
        name: 'Orders',
        path: '/orders',
        tags: [],
        confidence: 1,
        evidence: [],
        requiresAuth: false,
        roleIds: [],
      },
    ],
    edges: [],
    findings: [],
    coverage: {
      routes: { discovered: 1, visited: 0, rendered: 0 },
      pages: { discovered: 0, rendered: 0, withScenario: 0 },
      apis: { discovered: 0, observed: 0, asserted: 0 },
      roles: { configured: 0, exercised: 0 },
      scenarios: { discovered: 0, proposed: 0, approved: 0 },
      unresolved: 0,
    },
  } as unknown as Inventory;
}

describe('mergeExternalInventory', () => {
  it('adds new modules, routes and apis supplied by an agent', () => {
    const result = mergeExternalInventory(baseInventory(), {
      modules: [
        { name: '工单广场', description: '公开工单池', routes: ['/square'], apis: [{ method: 'get', path: '/api/square' }] },
      ],
      source: 'ai',
    });

    expect(result.added).toEqual({ modules: 1, routes: 1, apis: 1 });
    expect(result.warnings).toEqual([]);

    const module = result.inventory.nodes.find(
      (node): node is ModuleInventoryNode => node.kind === 'module' && node.name === '工单广场',
    );
    expect(module?.routeIds).toHaveLength(1);
    expect(module?.apiIds).toHaveLength(1);

    const api = result.inventory.nodes.find((node): node is ApiInventoryNode => node.kind === 'api');
    expect(api?.method).toBe('GET');
    expect(api?.urlPattern).toBe('/api/square');
    expect(api?.observed).toBe(false);
    expect(api?.evidence[0]?.kind).toBe('ai');
  });

  it('enriches an existing route instead of duplicating it', () => {
    const result = mergeExternalInventory(baseInventory(), {
      routes: [{ path: '/orders', module: '订单', requiresAuth: true, description: '订单列表' }],
    });

    expect(result.added.routes).toBe(0);
    expect(result.updated.routes).toBe(1);
    const routes = result.inventory.nodes.filter((node): node is RouteInventoryNode => node.kind === 'route');
    expect(routes).toHaveLength(1);
    expect(routes[0]?.description).toBe('订单列表');
  });

  it('normalizes paths and skips invalid entries without failing the batch', () => {
    const result = mergeExternalInventory(baseInventory(), {
      routes: [{ path: 'profile' }, { path: '   ' }],
      apis: [{ method: 'FLY', path: '/api/x' }, { method: 'POST', path: 'http://localhost:4178/api/y?a=1' }],
    });

    const paths = result.inventory.nodes
      .filter((node): node is RouteInventoryNode => node.kind === 'route')
      .map((node) => node.path);
    expect(paths).toContain('/profile');

    const apis = result.inventory.nodes.filter((node): node is ApiInventoryNode => node.kind === 'api');
    expect(apis.map((api) => api.urlPattern)).toEqual(['/api/y']);
    expect(result.warnings).toHaveLength(2);
  });

  it('recomputes coverage counters after merging', () => {
    const result = mergeExternalInventory(baseInventory(), {
      routes: [{ path: '/a' }, { path: '/b' }],
      apis: [{ method: 'GET', path: '/api/a' }],
    });
    expect(result.inventory.coverage.routes.discovered).toBe(3);
    expect(result.inventory.coverage.apis.discovered).toBe(1);
  });
});

describe('diffInventories', () => {
  it('reports recall and blind spots by business identity, not node id', () => {
    const base = baseInventory();
    const compare = mergeExternalInventory(baseInventory(), {
      modules: [{ name: '订单' }],
      routes: [{ path: '/orders/' }, { path: '/extra' }],
    }).inventory;

    const diff = diffInventories(base, compare);

    expect(diff.recall.routes).toBe(1);
    expect(diff.recall.modules).toBe(1);
    expect(diff.missing.routes).toEqual([]);
    expect(diff.extra.routes).toEqual(['/extra']);
  });

  it('flags routes missing from a black-box pass', () => {
    const base = mergeExternalInventory(baseInventory(), {
      routes: [{ path: '/deep-link' }, { path: '/another' }],
    }).inventory;
    const diff = diffInventories(base, baseInventory());

    expect(diff.missing.routes).toEqual(['/another', '/deep-link']);
    expect(diff.recall.routes).toBeCloseTo(0.333, 3);
  });
});
