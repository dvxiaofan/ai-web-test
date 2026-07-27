import { describe, it, expect } from 'vitest';
import { detectAuthStrategy, isSupportedStrategy } from '../../src/auth/detector.js';

describe('detectAuthStrategy', () => {
  it('honors explicit strategies', () => {
    expect(detectAuthStrategy({ strategy: 'ui', credentials: {}, target: { baseUrl: 'x' } })).toBe('ui');
    expect(detectAuthStrategy({ strategy: 'api', credentials: {}, target: { baseUrl: 'x' } })).toBe('api');
  });

  it('infers storage-state from storageStatePath', () => {
    expect(
      detectAuthStrategy({ strategy: 'auto', credentials: {}, target: { baseUrl: 'x', storageStatePath: 's.json' } }),
    ).toBe('storage-state');
  });

  it('infers custom from scriptPath', () => {
    expect(
      detectAuthStrategy({ strategy: 'auto', credentials: {}, target: { baseUrl: 'x', scriptPath: 'a.mjs' } }),
    ).toBe('custom');
  });

  it('infers api from tokenUrl', () => {
    expect(
      detectAuthStrategy({ strategy: 'auto', credentials: {}, target: { baseUrl: 'x', tokenUrl: 'https://x/token' } }),
    ).toBe('api');
  });

  it('infers api from token/apiKey env references', () => {
    expect(detectAuthStrategy({ strategy: 'auto', credentials: { tokenEnv: 'TOKEN' }, target: { baseUrl: 'x' } })).toBe('api');
    expect(detectAuthStrategy({ strategy: 'auto', credentials: { apiKeyEnv: 'KEY' }, target: { baseUrl: 'x' } })).toBe('api');
  });

  it('infers ui from username+password env references', () => {
    expect(
      detectAuthStrategy({ strategy: 'auto', credentials: { usernameEnv: 'U', passwordEnv: 'P' }, target: { baseUrl: 'x' } }),
    ).toBe('ui');
  });

  it('defaults to ui when nothing is configured', () => {
    expect(detectAuthStrategy({ strategy: 'auto', credentials: {}, target: { baseUrl: 'x' } })).toBe('ui');
  });
});

describe('isSupportedStrategy', () => {
  it('accepts known strategies', () => {
    for (const s of ['auto', 'ui', 'api', 'storage-state', 'sso-assisted', 'custom']) {
      expect(isSupportedStrategy(s)).toBe(true);
    }
  });

  it('rejects unknown strategies', () => {
    expect(isSupportedStrategy('oauth')).toBe(false);
  });
});
