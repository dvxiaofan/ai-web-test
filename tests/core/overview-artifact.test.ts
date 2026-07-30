import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactStore } from '../../src/core/artifacts.js';
import type { ProjectOverview } from '../../src/core/types.js';

const dirs: string[] = [];

function tmpStore(): ArtifactStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'awt-overview-'));
  dirs.push(dir);
  return new ArtifactStore(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sampleOverview(): ProjectOverview {
  return {
    schemaVersion: 1,
    updatedAt: '2026-07-30T00:00:00.000Z',
    e2eFlows: [
      { name: '提单→接单→关单', steps: ['创建', '受理', '关闭'], status: 'passed', scenarioIds: ['s-1'] },
    ],
    nextSteps: [{ priority: 'high', text: '补充权限矩阵用例' }],
    acceptance: [{ item: '全模块冒烟通过', done: false }],
    conclusions: [{ at: '2026-07-30T00:00:00.000Z', text: '首轮回归完成' }],
  };
}

describe('ArtifactStore overview', () => {
  it('round-trips overview.json', async () => {
    const store = tmpStore();
    await store.initialize();
    const overview = sampleOverview();

    const filePath = await store.writeOverview(overview);
    expect(filePath).toBe(store.layout.overview);
    expect(path.basename(filePath)).toBe('overview.json');

    await expect(store.readOverview()).resolves.toEqual(overview);
  });

  it('treats a missing overview as optional', async () => {
    const store = tmpStore();
    await store.initialize();
    await expect(store.readOverviewIfExists()).resolves.toBeUndefined();
  });

  it('returns the overview once written', async () => {
    const store = tmpStore();
    await store.initialize();
    await store.writeOverview(sampleOverview());
    const loaded = await store.readOverviewIfExists();
    expect(loaded?.e2eFlows[0]?.name).toBe('提单→接单→关单');
  });
});
