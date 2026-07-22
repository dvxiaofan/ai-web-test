import { describe, expect, it } from 'vitest';

import type { Inventory } from '../../src/core/index.js';
import { generateRouteSmokeScenarios } from '../../src/scenarios/index.js';

const inventory: Inventory = {
  schemaVersion: 1,
  id: 'inventory-test',
  project: { id: 'project-test', name: 'shop', rootDir: '/tmp/shop', baseUrl: 'http://app.test' },
  generatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [
    {
      id: 'route-products',
      kind: 'route',
      name: 'Products',
      path: '/products',
      moduleId: 'module-products',
      tags: [],
      confidence: 0.95,
      evidence: [],
      requiresAuth: false,
      roleIds: [],
    },
    {
      id: 'route-product',
      kind: 'route',
      name: 'Product',
      path: '/products/:id',
      moduleId: 'module-products',
      tags: [],
      confidence: 0.9,
      evidence: [],
      requiresAuth: false,
      roleIds: [],
    },
  ],
  edges: [],
  findings: [],
  coverage: {
    routes: { discovered: 2, visited: 0, rendered: 0 },
    pages: { discovered: 2, rendered: 0, withScenario: 0 },
    apis: { discovered: 0, observed: 0, asserted: 0 },
    roles: { configured: 0, exercised: 0 },
    scenarios: { discovered: 0, proposed: 0, approved: 0 },
    unresolved: 0,
  },
};

describe('generated route scenarios', () => {
  it('creates conservative smoke checks and skips unresolved dynamic routes', () => {
    const scenarios = generateRouteSmokeScenarios(inventory);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.moduleIds).toEqual(['module-products']);
    expect(scenarios[0]?.risk).toBe('read');
    expect(scenarios[0]?.steps.map((step) => step.action)).toEqual(['navigate', 'assert', 'assert', 'screenshot']);
  });
});
