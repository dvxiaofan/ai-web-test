import { describe, expect, it } from 'vitest';

import { getBooleanOption, getListOption, parseCliArgs } from '../../src/cli/args.js';

describe('CLI argument parsing', () => {
  it('maps --no-* flags to a false positive-form option', () => {
    const args = parseCliArgs(['run', '--no-trace', '--no-start']);
    expect(getBooleanOption(args, 'trace', true)).toBe(false);
    expect(getBooleanOption(args, 'start', true)).toBe(false);
  });

  it('supports repeated and comma-separated selectors', () => {
    const args = parseCliArgs(['plan', '--module', 'orders,cart', '--module', 'users']);
    expect(getListOption(args, 'module')).toEqual(['orders', 'cart', 'users']);
  });
});
