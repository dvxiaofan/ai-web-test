import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticate, resolveCredentials, saveStorageState, type AuthDeps } from '../../src/auth/index.js';
import type { BrowserAuthSurface, RoleAuthConfig, StorageState } from '../../src/auth/index.js';

const env = (map: Record<string, string>) => (name: string) => map[name];
const dir = mkdtempSync(path.join(tmpdir(), 'aitest-auth-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveCredentials', () => {
  it('maps env references to resolved values', () => {
    const resolved = resolveCredentials(
      {
        id: 'r',
        name: 'n',
        strategy: 'auto',
        credentials: { usernameEnv: 'U', passwordEnv: 'P', tokenEnv: 'T', extraEnv: ['X'] },
      },
      env({ U: 'u', P: 'p', T: 't', X: 'x' }),
    );
    expect(resolved).toEqual({ username: 'u', password: 'p', token: 't', apiKey: undefined, extra: { X: 'x' } });
  });
});

describe('authenticate dispatch', () => {
  it('dispatches ui with an injected browser surface', async () => {
    const surface: BrowserAuthSurface = {
      goto: async () => {},
      fill: async () => {},
      click: async () => {},
      getUrl: async () => 'x',
      getText: async () => null,
      isVisible: async () => false,
      captureStorageState: async () => ({ cookies: [{ name: 'c', value: 'v' }], origins: [] }),
    };
    const config: RoleAuthConfig = {
      id: 'r',
      name: 'n',
      strategy: 'auto',
      credentials: { usernameEnv: 'U', passwordEnv: 'P' },
      target: { baseUrl: 'https://app', loginUrl: 'https://app/login' },
    };
    const out = await authenticate(config, { env: env({ U: 'u', P: 'p' }), surface });
    expect(out.ok).toBe(true);
  });

  it('loads storage-state from a real file (auto-detected)', async () => {
    const file = path.join(dir, 's.json');
    const ss: StorageState = { cookies: [{ name: 'c', value: 'v' }], origins: [] };
    await saveStorageState(file, ss);
    const config: RoleAuthConfig = {
      id: 'r',
      name: 'n',
      strategy: 'auto',
      target: { baseUrl: 'x', storageStatePath: file },
    };
    const out = await authenticate(config, { env: () => undefined });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.storageState).toEqual(ss);
  });

  it('blocks api when no token client is available', async () => {
    const config: RoleAuthConfig = {
      id: 'r',
      name: 'n',
      strategy: 'auto',
      target: { baseUrl: 'x', tokenUrl: 'https://x/token' },
    };
    const out = await authenticate(config, { env: () => undefined });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('unsupported-strategy');
  });
});
