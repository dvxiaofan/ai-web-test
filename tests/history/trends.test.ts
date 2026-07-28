import { describe, expect, it } from 'vitest';

import { buildTrendReport, findFlakyScenarios, toTrendPoint } from '../../src/history/trends.js';
import type { RunCoverage, RunResult, ScenarioResult } from '../../src/core/types.js';

function coverage(overrides: Partial<RunCoverage> = {}): RunCoverage {
  return {
    routes: { selected: 10, visited: 8, passed: 7 },
    pages: { selected: 10, rendered: 8, failed: 1 },
    apis: { selected: 5, observed: 4, asserted: 3 },
    scenarios: { selected: 4, executed: 4, passed: 3, failed: 1, blocked: 0 },
    roles: { selected: 2, exercised: 2 },
    browsers: { selected: 1, exercised: 1 },
    unresolvedIds: [],
    ...overrides,
  };
}

function scenarioResult(scenarioId: string, status: ScenarioResult['status'], metadata?: ScenarioResult['metadata']): ScenarioResult {
  return {
    scenarioId,
    role: 'admin',
    browserProfileId: 'chromium',
    status,
    startedAt: '2026-07-28T00:00:00.000Z',
    steps: [],
    findingIds: [],
    artifacts: [],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function run(id: string, startedAt: string, overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    id,
    planId: 'plan-1',
    planDigest: 'digest',
    inventoryId: 'inv-1',
    inventoryDigest: 'digest',
    status: 'passed',
    startedAt,
    scenarios: [scenarioResult('scn-a', 'passed')],
    findings: [],
    coverage: coverage(),
    artifacts: [],
    ...overrides,
  };
}

describe('toTrendPoint', () => {
  it('computes pass rate and aggregates failure categories', () => {
    const point = toTrendPoint(run('run-1', '2026-07-01T00:00:00.000Z', {
      scenarios: [
        scenarioResult('scn-a', 'passed'),
        scenarioResult('scn-b', 'failed', { cleanupFailed: true }),
      ],
    }));
    expect(point.passRate).toBeCloseTo(0.75);
    expect(point.failureCategories.cleanup).toBe(1);
  });

  it('handles zero executed scenarios without dividing by zero', () => {
    const point = toTrendPoint(run('run-0', '2026-07-01T00:00:00.000Z', {
      coverage: coverage({ scenarios: { selected: 0, executed: 0, passed: 0, failed: 0, blocked: 0 } }),
      scenarios: [],
    }));
    expect(point.passRate).toBe(0);
  });
});

describe('buildTrendReport', () => {
  it('sorts points by startedAt and computes deltas against the previous run', () => {
    const older = run('run-1', '2026-07-01T00:00:00.000Z', {
      coverage: coverage({
        scenarios: { selected: 4, executed: 4, passed: 2, failed: 2, blocked: 0 },
        routes: { selected: 10, visited: 6, passed: 5 },
      }),
      scenarios: [scenarioResult('scn-a', 'failed', { cleanupFailed: true })],
    });
    const newer = run('run-2', '2026-07-02T00:00:00.000Z', {
      scenarios: [scenarioResult('scn-a', 'passed')],
    });
    const report = buildTrendReport([newer, older]);
    expect(report.points.map((p) => p.runId)).toEqual(['run-1', 'run-2']);
    expect(report.delta?.passRate).toBeCloseTo(0.75 - 0.5);
    expect(report.delta?.routesVisited).toBe(2);
    expect(report.delta?.resolvedFailureCategories).toContain('cleanup');
    expect(report.delta?.newFailureCategories).toHaveLength(0);
  });

  it('omits delta with fewer than two runs', () => {
    const report = buildTrendReport([run('run-1', '2026-07-01T00:00:00.000Z')]);
    expect(report.delta).toBeUndefined();
  });
});

describe('findFlakyScenarios', () => {
  it('flags scenarios with mixed pass/fail outcomes inside the window', () => {
    const runs = [
      run('run-1', '2026-07-01T00:00:00.000Z', { scenarios: [scenarioResult('scn-x', 'failed'), scenarioResult('scn-y', 'passed')] }),
      run('run-2', '2026-07-02T00:00:00.000Z', { scenarios: [scenarioResult('scn-x', 'passed'), scenarioResult('scn-y', 'passed')] }),
    ];
    expect(findFlakyScenarios(runs, 5)).toEqual(['scn-x']);
  });

  it('respects the window: old outcomes outside the window are ignored', () => {
    const runs = [
      run('run-1', '2026-07-01T00:00:00.000Z', { scenarios: [scenarioResult('scn-x', 'failed')] }),
      run('run-2', '2026-07-02T00:00:00.000Z', { scenarios: [scenarioResult('scn-x', 'passed')] }),
      run('run-3', '2026-07-03T00:00:00.000Z', { scenarios: [scenarioResult('scn-x', 'passed')] }),
    ];
    expect(findFlakyScenarios(runs, 2)).toEqual([]);
  });
});
