import { describe, expect, it } from 'vitest';

import type { Inventory } from '../../src/core/index.js';
import { mergeBrowserExploration } from '../../src/inventory/index.js';

const inventory: Inventory = {
  schemaVersion: 1,
  id: 'inventory-test',
  project: { id: 'project-test', name: 'shop', rootDir: '/tmp/shop', baseUrl: 'http://app.test' },
  generatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: 'route-products', kind: 'route', name: 'Products', path: '/products', tags: [], confidence: 0.9,
    evidence: [], requiresAuth: false, roleIds: [],
  }],
  edges: [],
  findings: [],
  coverage: {
    routes: { discovered: 1, visited: 0, rendered: 0 }, pages: { discovered: 0, rendered: 0, withScenario: 0 },
    apis: { discovered: 0, observed: 0, asserted: 0 }, roles: { configured: 0, exercised: 0 },
    scenarios: { discovered: 0, proposed: 0, approved: 0 }, unresolved: 0,
  },
};

describe('runtime inventory merge', () => {
  it('records rendered routes, observed APIs, and visual findings', () => {
    const merged = mergeBrowserExploration(inventory, {
      status: 'completed', baseUrl: 'http://app.test', browserName: 'chromium',
      startedAt: '2026-01-01T00:00:01.000Z', endedAt: '2026-01-01T00:00:02.000Z', warnings: [], skipped: [],
      pages: [{
        requestedUrl: 'http://app.test/products', finalUrl: 'http://app.test/products', title: 'Products',
        httpStatus: 200, rendered: true, links: [], controls: [], console: [], pageErrors: [], durationMs: 10,
        visualIssues: [{ kind: 'horizontal-overflow', severity: 'medium', message: 'Page is too wide.', selector: 'html' }],
        accessibilityIssues: [],
        network: [{
          url: 'http://app.test/api/products', method: 'GET', resourceType: 'fetch', status: 200,
          ok: true, blocked: false, timestamp: '2026-01-01T00:00:01.500Z',
        }],
      }],
    });
    expect(merged.coverage.routes.visited).toBe(1);
    expect(merged.coverage.apis.observed).toBe(1);
    expect(merged.findings.some((finding) => finding.category === 'visual')).toBe(true);
  });

  it('keeps skipped browser targets visible as coverage gaps', () => {
    const merged = mergeBrowserExploration(inventory, {
      status: 'partial',
      baseUrl: 'http://app.test',
      browserName: 'chromium',
      startedAt: '2026-01-01T00:00:01.000Z',
      endedAt: '2026-01-01T00:00:02.000Z',
      warnings: ['page limit reached'],
      pages: [],
      skipped: [{ url: 'http://app.test/products', reason: 'page-limit', detail: 'maxPages=0' }],
    });
    const gap = merged.findings.find((finding) => finding.category === 'coverage-gap');
    expect(gap).toMatchObject({ classification: 'coverage-gap', relatedIds: ['route-products'] });
    expect(merged.coverage.unresolved).toBe(1);
    expect(merged.metadata?.browserSkippedTargets).toEqual([
      { url: 'http://app.test/products', reason: 'page-limit', detail: 'maxPages=0' },
    ]);
  });

  describe('runtime-discovered routes get a module', () => {
    // Without this, black-box discovery produces zero module nodes, scenarios
    // inherit no moduleIds, and the by-module report tree drops every executed
    // scenario — a green run that delivers no evidence.
    const explore = (paths: string[]) =>
      mergeBrowserExploration(inventory, {
        status: 'completed',
        baseUrl: 'http://app.test',
        browserName: 'chromium',
        startedAt: '2026-01-01T00:00:01.000Z',
        endedAt: '2026-01-01T00:00:02.000Z',
        warnings: [],
        skipped: [],
        pages: paths.map((routePath) => ({
          requestedUrl: `http://app.test${routePath}`,
          finalUrl: `http://app.test${routePath}`,
          title: routePath,
          httpStatus: 200,
          rendered: true,
          links: [],
          controls: [],
          console: [],
          pageErrors: [],
          durationMs: 10,
          visualIssues: [],
          accessibilityIssues: [],
          network: [],
        })),
      });

    it('creates a module node and points the route at it', () => {
      const merged = explore(['/orders']);
      const route = merged.nodes.find((node) => node.kind === 'route' && node.name === '/orders');
      const module = merged.nodes.find((node) => node.kind === 'module' && node.name === 'orders');

      expect(module).toBeDefined();
      expect(route?.moduleId).toBe(module?.id);
      expect((module as { routeIds: string[] }).routeIds).toContain(route?.id);
    });

    it('groups sibling routes under one module instead of one module each', () => {
      const merged = explore(['/orders', '/orders/42']);
      const modules = merged.nodes.filter((node) => node.kind === 'module' && node.name === 'orders');
      expect(modules).toHaveLength(1);
      expect((modules[0] as { routeIds: string[] }).routeIds).toHaveLength(2);
    });

    it('gives the page the same module as its route', () => {
      const merged = explore(['/orders']);
      const page = merged.nodes.find((node) => node.kind === 'page');
      const module = merged.nodes.find((node) => node.kind === 'module' && node.name === 'orders');
      expect(page?.moduleId).toBe(module?.id);
    });
  });
});
