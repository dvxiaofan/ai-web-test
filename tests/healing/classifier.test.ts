import { describe, expect, it } from 'vitest';

import { classifyFailure, classifyRunFailures } from '../../src/healing/classifier.js';
import type { ScenarioResult, StepResult } from '../../src/core/types.js';

function step(overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepId: 'step-1',
    action: 'click',
    status: 'failed',
    startedAt: '2026-07-28T00:00:00.000Z',
    assertions: [],
    artifacts: [],
    ...overrides,
  };
}

function scenario(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenarioId: 'scn-1',
    role: 'admin',
    browserProfileId: 'chromium',
    status: 'failed',
    startedAt: '2026-07-28T00:00:00.000Z',
    endedAt: '2026-07-28T00:00:05.000Z',
    steps: [step()],
    findingIds: [],
    artifacts: [],
    ...overrides,
  };
}

describe('classifyFailure', () => {
  it('returns undefined for passed scenarios', () => {
    expect(classifyFailure({ scenario: scenario({ status: 'passed' }) })).toBeUndefined();
  });

  it('classifies cleanup failures with top priority even when other markers exist', () => {
    const result = classifyFailure({
      scenario: scenario({
        metadata: { cleanupFailed: true, failedRequests: [{ status: 500 }] },
      }),
    });
    expect(result?.category).toBe('cleanup');
    expect(result?.confidence).toBeGreaterThan(0.9);
  });

  it('classifies browser infrastructure failures', () => {
    const result = classifyFailure({
      scenario: scenario({ steps: [step({ error: { name: 'Error', message: 'Target crashed' } })] }),
    });
    expect(result?.category).toBe('browser-infrastructure');
  });

  it('classifies authentication failures from HTTP 401 evidence', () => {
    const result = classifyFailure({
      scenario: scenario({ metadata: { failedRequests: [{ method: 'GET', url: '/api/me', status: 401 }] } }),
    });
    expect(result?.category).toBe('authentication');
  });

  it('classifies permission failures from HTTP 403 evidence', () => {
    const result = classifyFailure({
      scenario: scenario({ metadata: { failedRequests: [{ method: 'POST', url: '/api/orders', status: 403 }] } }),
    });
    expect(result?.category).toBe('permission');
  });

  it('classifies navigation failures when the failing step is navigate', () => {
    const result = classifyFailure({
      scenario: scenario({ steps: [step({ action: 'navigate', error: { name: 'Error', message: 'timeout' } })] }),
    });
    expect(result?.category).toBe('navigation');
  });

  it('classifies locator failures from resolution errors', () => {
    const result = classifyFailure({
      scenario: scenario({
        steps: [step({ error: { name: 'TimeoutError', message: 'waiting for locator("#save") to be visible' } })],
      }),
    });
    expect(result?.category).toBe('locator');
  });

  it('classifies assertion failures from failed assert steps', () => {
    const result = classifyFailure({
      scenario: scenario({
        steps: [step({
          action: 'assert',
          assertions: [{ id: 'a1', status: 'failed', message: 'expected "Done" got "Pending"' }],
          error: { name: 'AssertionError', message: 'text mismatch' },
        })],
      }),
    });
    expect(result?.category).toBe('assertion');
  });

  it('classifies api failures from 5xx responses', () => {
    const result = classifyFailure({
      scenario: scenario({
        steps: [step({ error: { name: 'Error', message: 'step failed' } })],
        metadata: { failedRequests: [{ method: 'GET', url: '/api/list', status: 503 }] },
      }),
    });
    expect(result?.category).toBe('api');
  });

  it('classifies test-data failures from record markers', () => {
    const result = classifyFailure({
      scenario: scenario({ steps: [step({ error: { name: 'Error', message: 'record not found: order-42' } })] }),
    });
    expect(result?.category).toBe('test-data');
  });

  it('falls back to environment with low confidence', () => {
    const result = classifyFailure({
      scenario: scenario({ steps: [step({ error: { name: 'Error', message: 'something odd happened' } })] }),
    });
    expect(result?.category).toBe('environment');
    expect(result?.confidence).toBeLessThan(0.5);
  });

  it('attaches runtime evidence referencing the failure', () => {
    const result = classifyFailure({
      scenario: scenario({ steps: [step({ error: { name: 'Error', message: 'waiting for locator("#x")' } })] }),
    });
    expect(result?.evidence.length).toBeGreaterThan(0);
    expect(result?.evidence[0]?.kind).toBe('runtime');
  });
});

describe('classifyRunFailures', () => {
  it('classifies only failed scenarios', () => {
    const results = classifyRunFailures([
      scenario({ scenarioId: 'ok', status: 'passed' }),
      scenario({ scenarioId: 'bad', metadata: { cleanupFailed: true } }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.scenarioId).toBe('bad');
    expect(results[0]?.category).toBe('cleanup');
  });
});
