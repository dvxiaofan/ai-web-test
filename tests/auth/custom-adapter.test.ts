import { describe, it, expect } from 'vitest';
import { authenticateWithCustom, type ScriptRunner } from '../../src/auth/custom-adapter.js';
import type { StorageState } from '../../src/auth/types.js';

const ss: StorageState = { cookies: [{ name: 'c', value: 'v' }], origins: [] };

describe('authenticateWithCustom', () => {
  it('succeeds with the returned storage state', async () => {
    const runner: ScriptRunner = { run: async () => ({ ok: true, storageState: ss }) };
    const out = await authenticateWithCustom(runner, { roleId: 'r', strategy: 'custom', extraEnv: {} }, 'script.mjs');
    expect(out.ok).toBe(true);
  });

  it('blocks when the script reports failure', async () => {
    const runner: ScriptRunner = { run: async () => ({ ok: false, message: 'boom' }) };
    const out = await authenticateWithCustom(runner, { roleId: 'r', strategy: 'custom', extraEnv: {} }, 'script.mjs');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('custom-script-failed');
  });

  it('blocks when the returned state is invalid', async () => {
    const runner: ScriptRunner = {
      run: async () => ({ ok: true, storageState: { cookies: [], origins: 'x' } as unknown as StorageState }),
    };
    const out = await authenticateWithCustom(runner, { roleId: 'r', strategy: 'custom', extraEnv: {} }, 'script.mjs');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('custom-script-failed');
  });
});
