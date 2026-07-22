import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/core/index.js';

describe('sample configuration', () => {
  it('loads with safe read-only defaults and resolved paths', async () => {
    const config = await loadConfig(path.resolve('examples/sample.config.json'));
    expect(config.project.name).toBe('sample-shop');
    expect(config.policy.maxRisk).toBe('read');
    expect(config.target.rootDir).toContain('fixtures/sample-app');
  });
});
