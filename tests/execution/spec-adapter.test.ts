import { describe, expect, it } from 'vitest';
import { adaptControlledSpecToScenario, SpecSkippedError } from '../../src/execution/spec-adapter.js';
import type { ControlledSpec } from '../../src/execution/spec-types.js';

function mutationSpec(): ControlledSpec {
  return {
    schemaVersion: 1,
    id: 'spec-mutate',
    name: 'Create and clean up',
    risk: 'mutate',
    moduleIds: ['m1'],
    routeIds: ['r1'],
    roleIds: ['admin'],
    tags: ['crud'],
    createdAt: new Date().toISOString(),
    steps: [{ id: 's1', action: 'fill', description: 'set name', locator: { strategy: 'css', value: '#name' }, value: 'demo' }],
    cleanup: [{ id: 'c1', action: 'evaluate', description: 'remove demo', expression: 'removeDemo()', cleanup: true }],
  };
}

describe('adaptControlledSpecToScenario', () => {
  it('produces a valid TestScenario with controlled metadata', () => {
    const scenario = adaptControlledSpecToScenario(mutationSpec());
    expect(scenario.source).toBe('imported');
    expect(scenario.metadata).toMatchObject({ controlled: true, specId: 'spec-mutate' });
    expect(scenario.confidence).toBeGreaterThan(0);
    expect(scenario.confidence).toBeLessThanOrEqual(1);
  });

  it('appends cleanup steps as teardown and tags them', () => {
    const scenario = adaptControlledSpecToScenario(mutationSpec());
    const last = scenario.steps.at(-1);
    expect(last?.id).toBe('c1');
    expect(last?.metadata).toMatchObject({ cleanup: true });
    // The scenario risk is escalated to the highest step risk (destructive evaluate).
    expect(scenario.risk).toBe('destructive');
  });

  it('assigns each step the minimum risk implied by its action', () => {
    const scenario = adaptControlledSpecToScenario(mutationSpec());
    const fillStep = scenario.steps.find((step) => step.id === 's1');
    expect(fillStep?.risk).toBe('mutate');
  });

  it('throws SpecSkippedError for a skipped spec', () => {
    const spec: ControlledSpec = { ...mutationSpec(), skip: { reason: 'Feature frozen this sprint' } };
    expect(() => adaptControlledSpecToScenario(spec)).toThrow(SpecSkippedError);
  });

  it('produces a scenario that satisfies the canonical scenario contract', () => {
    const scenario = adaptControlledSpecToScenario({
      schemaVersion: 1,
      id: 'spec-read',
      name: 'Read smoke',
      risk: 'read',
      moduleIds: [],
      routeIds: [],
      roleIds: [],
      tags: [],
      createdAt: new Date().toISOString(),
      steps: [{ id: 's1', action: 'navigate', description: 'open', url: 'https://example.com/' }],
    });
    expect(scenario.steps).toHaveLength(1);
    expect(scenario.risk).toBe('read');
  });
});
