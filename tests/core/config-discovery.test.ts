import { describe, expect, it } from 'vitest';
import { ConfigValidationError, validateConfig } from '../../src/core/config.js';

const base = { rootDir: '/app', baseUrl: 'http://localhost:3000' };

describe('target.discovery', () => {
  it('defaults to static so existing configs are unchanged', () => {
    const config = validateConfig(base);
    expect(config.target.discovery).toBe('static');
    expect(config.target.seedPaths).toEqual([]);
  });

  it('accepts runtime-first when a baseUrl is present', () => {
    const config = validateConfig({
      ...base,
      target: { ...base, discovery: 'runtime-first', seedPaths: ['/login', '/orders'] },
    });
    expect(config.target.discovery).toBe('runtime-first');
    expect(config.target.seedPaths).toEqual(['/login', '/orders']);
  });

  it('rejects runtime-first without a baseUrl', () => {
    expect(() => validateConfig({ rootDir: '/app', target: { rootDir: '/app', discovery: 'runtime-first' } })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects an unknown discovery mode', () => {
    expect(() => validateConfig({ ...base, target: { ...base, discovery: 'psychic' } })).toThrow(
      ConfigValidationError,
    );
  });

  it('drops blank seed paths', () => {
    const config = validateConfig({ ...base, target: { ...base, seedPaths: ['/a', '  '] } });
    expect(config.target.seedPaths).toEqual(['/a']);
  });
});
