import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../src/core/index.js';
import { McpService } from '../../src/mcp/index.js';
import type {
  AssertStep,
  RunCoverage,
  RunResult,
  ScenarioResult,
  ScenarioStep,
  TestScenario,
} from '../../src/core/types.js';

function coverage(): RunCoverage {
  return {
    routes: { selected: 0, visited: 0, passed: 0 },
    pages: { selected: 0, rendered: 0, failed: 0 },
    apis: { selected: 0, observed: 0, asserted: 0 },
    scenarios: { selected: 0, executed: 0, passed: 0, failed: 0, blocked: 0 },
    roles: { selected: 0, exercised: 0 },
    browsers: { selected: 0, exercised: 0 },
    unresolvedIds: [],
  };
}

function scenarioResult(
  scenarioId: string,
  status: ScenarioResult['status'],
  overrides: Partial<ScenarioResult> = {},
): ScenarioResult {
  return {
    scenarioId,
    role: 'admin',
    browserProfileId: 'chromium',
    status,
    startedAt: '2026-07-28T00:00:00.000Z',
    steps: [],
    findingIds: [],
    artifacts: [],
    ...overrides,
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

describe('McpService healing + history (Phase 6 wiring)', () => {
  let configPath: string;
  let tmpDir: string;
  let store: ArtifactStore;
  let service: McpService;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'awt-heal-'));
    const raw = JSON.parse(await readFile(path.resolve('examples/sample.config.json'), 'utf8'));
    raw.artifacts.directory = path.join(tmpDir, '.artifacts');
    configPath = path.join(tmpDir, 'ai-web-test.config.json');
    await writeFile(configPath, JSON.stringify(raw, null, 2));
    store = new ArtifactStore(raw.artifacts.directory);
    await store.initialize();
    service = new McpService({ configPath });

    // Auth failure run: HTTP 401 in metadata.failedRequests -> 'authentication'.
    await store.writeRunResult(
      run('run-auth', '2026-07-28T00:00:00.000Z', {
        status: 'failed',
        scenarios: [
          scenarioResult('scn-auth', 'failed', {
            metadata: { failedRequests: [{ status: 401, url: '/api/login' }] },
          }),
        ],
      }),
    );

    // Locator failure run: step error 'no element matches selector' -> 'locator'.
    await store.writeRunResult(
      run('run-loc', '2026-07-28T00:01:00.000Z', {
        status: 'failed',
        scenarios: [
          scenarioResult('scn-loc', 'failed', {
            steps: [
              {
                id: 'l',
                action: 'click',
                status: 'failed',
                error: { name: 'Error', message: 'no element matches selector' },
                target: { strategy: 'role', value: 'button', name: 'Submit' },
              },
            ],
          }),
        ],
      }),
    );

    // Two runs for the trend report.
    await store.writeRunResult(
      run('run-t1', '2026-07-26T00:00:00.000Z', {
        scenarios: [scenarioResult('scn-a', 'failed'), scenarioResult('scn-b', 'passed')],
      }),
    );
    await store.writeRunResult(
      run('run-t2', '2026-07-27T00:00:00.000Z', {
        scenarios: [scenarioResult('scn-a', 'passed')],
      }),
    );
  });

  afterAll(async () => {
    await import('node:fs/promises').then((fs) => fs.rm(tmpDir, { recursive: true, force: true }));
  });

  it('healingClassify returns deterministic categories with evidence', async () => {
    const { runId, classifications } = await service.healingClassify({ runId: 'run-auth' });
    expect(runId).toBe('run-auth');
    expect(classifications).toHaveLength(1);
    expect(classifications[0]?.scenarioId).toBe('scn-auth');
    expect(classifications[0]?.category).toBe('authentication');
    expect(classifications[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('healingReview forbids a proposal that weakens an assertion', async () => {
    const before = makeScenario(
      [
        {
          id: 's2',
          action: 'assert',
          risk: 'read',
          assertion: 'text',
          locator: { strategy: 'testId', value: 'order-title' },
          comparator: 'equals',
          expected: 'Hello',
        },
      ],
      { id: 'scn-auth' },
    );
    const after: TestScenario = JSON.parse(JSON.stringify(before));
    delete (after.steps[0] as Partial<AssertStep>).expected;
    const res = await service.healingReview({ runId: 'run-auth', before, after });
    expect(res.verdict).toBe('forbidden');
    expect(res.status).toBe('rejected');
  });

  it('healingReview auto-applies an equivalent locator update', async () => {
    const before = makeScenario(
      [{ id: 's1', action: 'click', risk: 'read', locator: { strategy: 'role', value: 'button', name: 'Submit' } }],
      { id: 'scn-loc' },
    );
    const after = makeScenario(
      [{ id: 's1', action: 'click', risk: 'read', locator: { strategy: 'testId', value: 'submit-btn' } }],
      { id: 'scn-loc' },
    );
    const res = await service.healingReview({ runId: 'run-loc', before, after });
    expect(res.verdict).toBe('auto-apply');
    expect(res.status).toBe('auto-applied');
  });

  it('healingTrends builds a report from stored runs', async () => {
    const report = await service.healingTrends();
    expect(report.points.length).toBeGreaterThanOrEqual(2);
    expect(report.flakyScenarioIds).toBeInstanceOf(Array);
    expect(report.delta).toBeDefined();
  });

  it('healingRetention dry-run reports removals without deleting', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await store.writeRunResult(run(`run-dry-${i}`, `2026-07-2${i}T00:00:00.000Z`));
    }
    const report = await service.healingRetention({ maxRuns: 2, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.removed.map((entry) => entry.runId)).toContain('run-dry-1');
    await expect(store.readRunResult('run-dry-1')).resolves.toBeTruthy();
  });

  it('healingRetention keeps the newest maxRuns', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await store.writeRunResult(run(`run-rem-${i}`, `2026-08-0${i}T00:00:00.000Z`));
    }
    const report = await service.healingRetention({ maxRuns: 2 });
    expect(report.dryRun).toBe(false);
    expect(report.kept).toHaveLength(2);
    expect(report.kept).toContain('run-rem-5');
    expect(report.kept).toContain('run-rem-4');
  });
});
