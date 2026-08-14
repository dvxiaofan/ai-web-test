import { describe, expect, it } from 'vitest';
import { createDefaultPolicy, type TestScenario } from '../../src/core/index.js';
import {
  compileControlledSpec,
  compileScenarioActions,
  SpecCompilationError,
} from '../../src/execution/action-compiler.js';
import type { ControlledSpec } from '../../src/execution/spec-types.js';

const BASE_URL = 'https://example.com';

function readSpec(overrides: Partial<ControlledSpec> = {}): ControlledSpec {
  return {
    schemaVersion: 1,
    id: 'spec-1',
    name: 'Read smoke',
    risk: 'read',
    moduleIds: ['m1'],
    routeIds: ['r1'],
    roleIds: ['user'],
    tags: ['smoke'],
    createdAt: new Date().toISOString(),
    steps: [{ id: 's1', action: 'navigate', description: 'open', url: `${BASE_URL}/` }],
    ...overrides,
  };
}

describe('compileControlledSpec', () => {
  it('compiles a read spec with all steps policy-allowed under the default policy', () => {
    const policy = createDefaultPolicy(BASE_URL);
    const result = compileControlledSpec(readSpec(), policy, BASE_URL);
    expect(result.scenario.source).toBe('imported');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.policyAllowed).toBe(true);
    expect(result.actions[0]!.description).toBe('open');
  });

  it('flags a mutating step as policy-violating when the plan is read-only', () => {
    const policy = createDefaultPolicy(BASE_URL);
    const spec = readSpec({
      risk: 'mutate',
      steps: [{ id: 's1', action: 'fill', description: 'set name', locator: { strategy: 'css', value: '#name' }, value: 'x' }],
      cleanup: [{ id: 'c1', action: 'evaluate', description: 'cleanup', expression: 'cleanup()', cleanup: true }],
    });
    const result = compileControlledSpec(spec, policy, BASE_URL);
    const fill = result.actions.find((action) => action.stepId === 's1');
    expect(fill?.policyAllowed).toBe(false);
    expect(fill?.policyCode).toBe('risk-exceeds-plan');
  });

  it('flags an unapproved host', () => {
    const policy = createDefaultPolicy(BASE_URL);
    const spec = readSpec({ steps: [{ id: 's1', action: 'navigate', description: 'evil', url: 'https://evil.example.net/' }] });
    const result = compileControlledSpec(spec, policy, BASE_URL);
    const step = result.actions.find((action) => action.stepId === 's1');
    expect(step?.policyAllowed).toBe(false);
  });

  it('throws SpecCompilationError when governance validation fails', () => {
    const policy = createDefaultPolicy(BASE_URL);
    const spec = readSpec({ risk: 'mutate' }); // no cleanup -> mutate-without-cleanup
    expect(() => compileControlledSpec(spec, policy, BASE_URL)).toThrow(SpecCompilationError);
  });

  it('tags cleanup steps in the compiled actions', () => {
    const policy = createDefaultPolicy(BASE_URL);
    const spec = readSpec({
      risk: 'mutate',
      steps: [{ id: 's1', action: 'fill', description: 'set', locator: { strategy: 'css', value: '#x' }, value: 'y' }],
      cleanup: [{ id: 'c1', action: 'evaluate', description: 'clean', expression: 'clean()', cleanup: true }],
    });
    const result = compileControlledSpec(spec, policy, BASE_URL);
    const cleanup = result.actions.find((action) => action.stepId === 'c1');
    expect(cleanup?.cleanup).toBe(true);
  });
});

describe('compileScenarioActions (DSL)', () => {
  it('pre-checks a plain TestScenario with the same policy engine', () => {
    const policy = createDefaultPolicy(BASE_URL);
    const scenario: TestScenario = {
      schemaVersion: 1,
      id: 'dsl-1',
      name: 'DSL',
      source: 'generated',
      risk: 'read',
      confidence: 0.9,
      moduleIds: [],
      routeIds: [],
      operationIds: [],
      roleIds: [],
      tags: [],
      prerequisites: [],
      evidence: [],
      createdAt: new Date().toISOString(),
      steps: [{ id: 's1', action: 'navigate', name: 'open', risk: 'read', url: `${BASE_URL}/` }],
    };
    const actions = compileScenarioActions(scenario, policy, BASE_URL);
    expect(actions[0]!.policyAllowed).toBe(true);
  });
});
