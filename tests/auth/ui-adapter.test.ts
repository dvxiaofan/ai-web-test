import { describe, it, expect } from 'vitest';
import { authenticateWithUi, type BrowserAuthSurface } from '../../src/auth/ui-adapter.js';
import type { StorageState } from '../../src/auth/types.js';

function makeSurface(opts: {
  visible?: Record<string, boolean>;
  storageState?: StorageState;
  errorText?: string;
}): BrowserAuthSurface {
  return {
    goto: async () => {},
    fill: async () => {},
    click: async () => {},
    getUrl: async () => 'https://app/home',
    getText: async () => opts.errorText ?? null,
    isVisible: async (s) => opts.visible?.[s] ?? false,
    captureStorageState: async () => opts.storageState ?? { cookies: [], origins: [] },
  };
}

const baseCtx = { roleId: 'r1', strategy: 'ui' as const };
const baseOpts = {
  loginUrl: 'https://app/login',
  usernameSelector: '#u',
  passwordSelector: '#p',
  submitSelector: '#s',
};

describe('authenticateWithUi', () => {
  it('blocks when credentials are missing', async () => {
    const out = await authenticateWithUi(makeSurface({}), baseCtx, baseOpts);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('credentials-missing');
  });

  it('succeeds and captures storage state', async () => {
    const ss: StorageState = { cookies: [{ name: 'sid', value: 'v' }], origins: [] };
    const out = await authenticateWithUi(makeSurface({ storageState: ss }), { ...baseCtx, username: 'u', password: 'p' }, baseOpts);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.storageState).toEqual(ss);
  });

  it('blocks on a login-failure indicator', async () => {
    const out = await authenticateWithUi(
      makeSurface({ visible: { '#err': true }, errorText: 'bad password' }),
      { ...baseCtx, username: 'u', password: 'p' },
      { ...baseOpts, errorIndicatorSelector: '#err' },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason.code).toBe('login-failed');
      expect(out.reason.message).toContain('bad password');
    }
  });

  it('blocks as sso-mfa-required when the success indicator is missing', async () => {
    const out = await authenticateWithUi(
      makeSurface({}),
      { ...baseCtx, username: 'u', password: 'p' },
      { ...baseOpts, successIndicatorSelector: '#dash' },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('sso-mfa-required');
  });

  it('blocks when no session is produced', async () => {
    const out = await authenticateWithUi(
      makeSurface({ storageState: { cookies: [], origins: [] } }),
      { ...baseCtx, username: 'u', password: 'p' },
      baseOpts,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.code).toBe('login-failed');
  });
});
