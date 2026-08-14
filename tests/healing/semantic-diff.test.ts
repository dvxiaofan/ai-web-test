import { describe, expect, it } from 'vitest';

import { diffScenarios } from '../../src/healing/semantic-diff.js';
import type { AssertStep, ScenarioStep, TestScenario } from '../../src/core/types.js';

function makeScenario(steps: ScenarioStep[], overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    schemaVersion: 1,
    id: 'scn-1',
    name: 'Demo',
    source: 'user',
    confidence: 1,
    moduleIds: [],
    routeIds: [],
    operationIds: [],
    roleIds: ['admin'],
    tags: [],
    risk: 'read',
    steps,
    evidence: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

const navigate: ScenarioStep = { id: 's1', action: 'navigate', risk: 'read', url: 'https://app.example.com/orders' };
const assertStep: AssertStep = {
  id: 's2',
  action: 'assert',
  risk: 'read',
  assertion: 'text',
  locator: { strategy: 'testId', value: 'order-title' },
  comparator: 'equals',
  expected: 'Order #42',
};

describe('diffScenarios', () => {
  it('reports identical scenarios as having no changes', () => {
    const before = makeScenario([navigate, assertStep]);
    const diff = diffScenarios(before, structuredClone(before));
    expect(diff.identical).toBe(true);
    expect(diff.changes).toHaveLength(0);
  });

  it('flags removed assertions as assertion-removed (not step-removed)', () => {
    const diff = diffScenarios(makeScenario([navigate, assertStep]), makeScenario([navigate]));
    expect(diff.changes.map((c) => c.kind)).toContain('assertion-removed');
    expect(diff.changes.map((c) => c.kind)).not.toContain('step-removed');
  });

  it('flags weakened comparators as assertion-weakened', () => {
    const weaker: AssertStep = { ...assertStep, comparator: 'contains' };
    const diff = diffScenarios(makeScenario([assertStep]), makeScenario([weaker]));
    expect(diff.changes.map((c) => c.kind)).toContain('assertion-weakened');
  });

  it('flags dropped expected values as assertion-weakened', () => {
    const { expected: _dropped, ...noExpected } = assertStep;
    const diff = diffScenarios(makeScenario([assertStep]), makeScenario([noExpected]));
    expect(diff.changes.map((c) => c.kind)).toContain('assertion-weakened');
  });

  it('flags changed expected values as assertion-changed (approval, not forbidden)', () => {
    const changed: AssertStep = { ...assertStep, expected: 'Order #43' };
    const diff = diffScenarios(makeScenario([assertStep]), makeScenario([changed]));
    expect(diff.changes.map((c) => c.kind)).toContain('assertion-changed');
    expect(diff.changes.map((c) => c.kind)).not.toContain('assertion-weakened');
  });

  it('classifies same-host URL changes as url-path-updated and cross-host as host-expanded', () => {
    const samePath: ScenarioStep = { ...navigate, url: 'https://app.example.com/orders/new' };
    const otherHost: ScenarioStep = { ...navigate, url: 'https://evil.example.net/orders' };
    expect(diffScenarios(makeScenario([navigate]), makeScenario([samePath])).changes.map((c) => c.kind)).toContain('url-path-updated');
    expect(diffScenarios(makeScenario([navigate]), makeScenario([otherHost])).changes.map((c) => c.kind)).toContain('host-expanded');
  });

  it('classifies testId locator updates as test-id-updated', () => {
    const before = makeScenario([{ id: 's3', action: 'click', risk: 'mutate', locator: { strategy: 'testId', value: 'save-btn' } }]);
    const after = makeScenario([{ id: 's3', action: 'click', risk: 'mutate', locator: { strategy: 'testId', value: 'save-button' } }]);
    expect(diffScenarios(before, after).changes.map((c) => c.kind)).toContain('test-id-updated');
  });

  it('classifies same-role name changes as accessible-name-updated', () => {
    const before = makeScenario([{ id: 's3', action: 'click', risk: 'mutate', locator: { strategy: 'role', value: 'button', name: 'Save' } }]);
    const after = makeScenario([{ id: 's3', action: 'click', risk: 'mutate', locator: { strategy: 'role', value: 'button', name: 'Save changes' } }]);
    expect(diffScenarios(before, after).changes.map((c) => c.kind)).toContain('accessible-name-updated');
  });

  it('detects wait adjustments', () => {
    const before = makeScenario([{ id: 's4', action: 'wait', risk: 'read', durationMs: 500 }]);
    const after = makeScenario([{ id: 's4', action: 'wait', risk: 'read', for: 'network-idle' }]);
    expect(diffScenarios(before, after).changes.map((c) => c.kind)).toContain('wait-adjusted');
  });

  it('detects role changes, risk increases and skip flags', () => {
    const before = makeScenario([navigate]);
    const after = makeScenario([navigate], { roleIds: ['viewer'], risk: 'destructive', metadata: { skip: true } });
    const kinds = diffScenarios(before, after).changes.map((c) => c.kind);
    expect(kinds).toContain('role-changed');
    expect(kinds).toContain('risk-increased');
    expect(kinds).toContain('skip-added');
  });

  it('detects removed cleanup steps as cleanup-removed', () => {
    const cleanup: ScenarioStep = { id: 's9', action: 'click', risk: 'mutate', locator: { strategy: 'testId', value: 'delete-row' }, metadata: { cleanup: true } };
    const diff = diffScenarios(makeScenario([navigate, cleanup]), makeScenario([navigate]));
    expect(diff.changes.map((c) => c.kind)).toContain('cleanup-removed');
  });

  it('detects guard removal and test-data strategy changes', () => {
    const before = makeScenario([navigate], { metadata: { guard: true, testDataStrategy: 'isolated' } });
    const after = makeScenario([navigate], { metadata: { testDataStrategy: 'shared' } });
    const kinds = diffScenarios(before, after).changes.map((c) => c.kind);
    expect(kinds).toContain('guard-disabled');
    expect(kinds).toContain('test-data-strategy-changed');
  });
});
