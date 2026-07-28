import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArtifactStore } from '../../src/core/artifacts.js';
import { applyRetentionPolicy } from '../../src/history/retention.js';
import type { RunCoverage, RunResult } from '../../src/core/types.js';

let workDir: string;
let store: ArtifactStore;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'awt-retention-'));
  store = new ArtifactStore(workDir);
  await store.initialize();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

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

async function writeRun(id: string, startedAt: string): Promise<void> {
  const result: RunResult = {
    schemaVersion: 1,
    id,
    planId: 'plan-1',
    planDigest: 'digest',
    inventoryId: 'inv-1',
    inventoryDigest: 'digest',
    status: 'passed',
    startedAt,
    scenarios: [],
    findings: [],
    coverage: coverage(),
    artifacts: [],
  };
  await store.writeRunResult(result);
}

describe('applyRetentionPolicy', () => {
  it('keeps the newest maxRuns and removes the rest', async () => {
    await writeRun('run-1', '2026-07-01T00:00:00.000Z');
    await writeRun('run-2', '2026-07-02T00:00:00.000Z');
    await writeRun('run-3', '2026-07-03T00:00:00.000Z');

    const report = await applyRetentionPolicy(store, { maxRuns: 2 });
    expect(report.kept).toEqual(['run-3', 'run-2']);
    expect(report.removed.map((entry) => entry.runId)).toEqual(['run-1']);
    expect(report.removed[0]?.reason).toBe('max-runs');
    await expect(store.readRunResult('run-1')).rejects.toThrow();
    await expect(store.readRunResult('run-3')).resolves.toBeTruthy();
  });

  it('removes runs older than maxAgeDays', async () => {
    await writeRun('run-old', '2026-06-01T00:00:00.000Z');
    await writeRun('run-new', '2026-07-27T00:00:00.000Z');

    const report = await applyRetentionPolicy(store, { maxAgeDays: 30 }, { now: new Date('2026-07-28T00:00:00.000Z') });
    expect(report.removed.map((entry) => entry.runId)).toEqual(['run-old']);
    expect(report.removed[0]?.reason).toBe('max-age');
    expect(report.kept).toEqual(['run-new']);
  });

  it('never removes pinned runs', async () => {
    await writeRun('run-pinned', '2026-06-01T00:00:00.000Z');
    await writeRun('run-2', '2026-07-02T00:00:00.000Z');
    await writeRun('run-3', '2026-07-03T00:00:00.000Z');

    const report = await applyRetentionPolicy(store, { maxRuns: 1, maxAgeDays: 30, pinnedRunIds: ['run-pinned'] }, { now: new Date('2026-07-28T00:00:00.000Z') });
    expect(report.kept).toContain('run-pinned');
    await expect(store.readRunResult('run-pinned')).resolves.toBeTruthy();
  });

  it('dry run reports removals without deleting anything', async () => {
    await writeRun('run-1', '2026-07-01T00:00:00.000Z');
    await writeRun('run-2', '2026-07-02T00:00:00.000Z');

    const report = await applyRetentionPolicy(store, { maxRuns: 1 }, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.removed.map((entry) => entry.runId)).toEqual(['run-1']);
    await expect(store.readRunResult('run-1')).resolves.toBeTruthy();
  });

  it('returns an empty report when no runs exist', async () => {
    const report = await applyRetentionPolicy(store, { maxRuns: 5 });
    expect(report.kept).toEqual([]);
    expect(report.removed).toEqual([]);
  });
});
