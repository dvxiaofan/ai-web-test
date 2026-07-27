import { describe, it, expect } from 'vitest';
import { validateConfig, ConfigValidationError } from '../../src/core/config.js';

const base = { rootDir: '/app', baseUrl: 'http://localhost:3000' };

describe('auth config', () => {
  it('builds auth roles with resolved paths and default strategy', () => {
    const config = validateConfig({
      ...base,
      auth: {
        roles: [
          {
            name: 'admin',
            strategy: 'ui',
            credentials: { usernameEnv: 'ADMIN_USER', passwordEnv: 'ADMIN_PASS' },
            target: { loginUrl: 'http://localhost:3000/login', storageStatePath: 'state/admin.json' },
          },
        ],
      },
    });
    expect(config.auth.roles).toHaveLength(1);
    const role = config.auth.roles[0]!;
    expect(role.strategy).toBe('ui');
    expect(role.target?.storageStatePath).toBe('/app/state/admin.json');
    expect(role.target?.loginUrl).toBe('http://localhost:3000/login');
    expect(role.credentials?.usernameEnv).toBe('ADMIN_USER');
  });

  it('defaults strategy to auto when omitted', () => {
    const config = validateConfig({ ...base, auth: { roles: [{ name: 'guest' }] } });
    expect(config.auth.roles[0]!.strategy).toBe('auto');
  });

  it('rejects duplicate auth role names', () => {
    expect(() =>
      validateConfig({ ...base, auth: { roles: [{ name: 'a' }, { name: 'a' }] } }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects unknown strategy', () => {
    expect(() =>
      validateConfig({ ...base, auth: { roles: [{ name: 'a', strategy: 'oauth' }] } }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects invalid env names', () => {
    expect(() =>
      validateConfig({ ...base, auth: { roles: [{ name: 'a', credentials: { usernameEnv: '1bad' } }] } }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects invalid loginUrl', () => {
    expect(() =>
      validateConfig({ ...base, auth: { roles: [{ name: 'a', target: { loginUrl: 'ftp://x' } }] } }),
    ).toThrow(ConfigValidationError);
  });

  it('accepts a missing auth section', () => {
    const config = validateConfig(base);
    expect(config.auth.roles).toEqual([]);
  });
});
