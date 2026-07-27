import { describe, it, expect } from 'vitest';
import { authenticateWithApi, type TokenClient } from '../../src/auth/api-adapter.js';

function client(status: number, cookies: { name: string; value: string }[] = []): TokenClient {
  return { exchange: async () => ({ status, body: {}, cookies }) };
}

describe('authenticateWithApi', () => {
  it('blocks when no credentials are supplied', async () => {
    const out = await authenticateWithApi(client(200), { roleId: 'r', strategy: 'api' }, { tokenUrl: 'u', body: {} });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('credentials-missing');
  });

  it('succeeds and converts cookies to storage state', async () => {
    const out = await authenticateWithApi(
      client(200, [{ name: 't', value: 'x' }]),
      { roleId: 'r', strategy: 'api', token: 'tok' },
      { tokenUrl: 'u', body: { token: 'tok' } },
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.storageState.cookies[0]?.name).toBe('t');
  });

  it('blocks on a non-2xx response', async () => {
    const out = await authenticateWithApi(
      client(500),
      { roleId: 'r', strategy: 'api', apiKey: 'k' },
      { tokenUrl: 'u', body: { apiKey: 'k' } },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('login-failed');
  });
});
