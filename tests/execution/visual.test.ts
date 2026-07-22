import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareOrCreateVisualSnapshot } from '../../src/execution/visual.js';

describe('visual snapshot baselines', () => {
  it('creates a baseline and detects a changed snapshot', async () => {
    const workspace = path.join(os.tmpdir(), `ai-web-test-visual-${process.pid}-${Date.now()}`);
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    const current = path.join(workspace, 'current.png');
    await writeFile(current, Buffer.from('first'));
    const missing = await compareOrCreateVisualSnapshot(current, { baselineDir: path.join(workspace, 'baseline'), baselineKey: 'home' });
    expect(missing.baselineExists).toBe(false);
    const first = await compareOrCreateVisualSnapshot(current, { baselineDir: path.join(workspace, 'baseline'), baselineKey: 'home', updateBaseline: true });
    expect(first.baselineExists).toBe(false);
    await writeFile(current, Buffer.from('second'));
    const second = await compareOrCreateVisualSnapshot(current, { baselineDir: path.join(workspace, 'baseline'), baselineKey: 'home' });
    expect(second.changed).toBe(true);
    await rm(workspace, { recursive: true, force: true });
  });
});
