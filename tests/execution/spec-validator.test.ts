import { describe, expect, it } from 'vitest';
import { validateControlledSpec } from '../../src/execution/spec-validator.js';
import type { ControlledSpec, SpecValidationContext } from '../../src/execution/spec-types.js';

function baseSpec(overrides: Partial<ControlledSpec> = {}): ControlledSpec {
  return {
    schemaVersion: 1,
    id: 'spec-1',
    name: 'Login smoke',
    risk: 'read',
    moduleIds: ['m1'],
    routeIds: ['r1'],
    roleIds: ['user'],
    tags: ['smoke'],
    createdAt: new Date().toISOString(),
    steps: [
      { id: 's1', action: 'navigate', description: 'Open home', url: 'https://example.com/' },
      {
        id: 's2',
        action: 'assert',
        description: 'Home heading visible',
        assertion: 'text',
        expected: 'Welcome',
        locator: { strategy: 'text', value: 'Welcome' },
      },
    ],
    ...overrides,
  };
}

function codes(spec: ControlledSpec, ctx?: SpecValidationContext): Set<string> {
  const result = validateControlledSpec(spec, ctx);
  return new Set([...result.errors, ...result.warnings].map((issue) => issue.code));
}

describe('validateControlledSpec', () => {
  it('accepts a well-formed read spec', () => {
    const result = validateControlledSpec(baseSpec());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a hard-coded secret in a value', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'fill', description: 'set pw', locator: { strategy: 'css', value: '#pw' }, value: 'password=hunter2' }],
    });
    const result = validateControlledSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'hardcoded-secret')).toBe(true);
  });

  it('accepts env-referenced secrets', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'fill', description: 'set pw', locator: { strategy: 'css', value: '#pw' }, value: '${API_TOKEN}' }],
    });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'hardcoded-secret')).toBe(false);
  });

  it('rejects dangerous API usage (child_process/eval/spawn)', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'evaluate', description: 'run', expression: "require('child_process').exec('rm -rf /')" }],
    });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'dangerous-api')).toBe(true);
  });

  it('rejects risky filesystem access', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'evaluate', description: 'run', expression: 'fs.unlinkSync("/etc/passwd")' }],
    });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'risky-file-access')).toBe(true);
  });

  it('rejects attempts to bypass the network policy', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'evaluate', description: 'run', expression: 'page.route("**/*", r => r.abort())' }],
    });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'bypassed-network-policy')).toBe(true);
  });

  it('rejects absolute XPath', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'click', description: 'click', locator: { strategy: 'xpath', value: '/html/body/div[1]/button' } }],
    });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'absolute-xpath')).toBe(true);
  });

  it('rejects a skip without a reason', () => {
    const spec = baseSpec({ skip: { reason: '' } });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'skip-without-reason')).toBe(true);
  });

  it('rejects a mutating spec with no cleanup', () => {
    const spec = baseSpec({ risk: 'mutate' });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'mutate-without-cleanup')).toBe(true);
  });

  it('accepts a mutating spec that declares cleanup', () => {
    const spec = baseSpec({
      risk: 'mutate',
      steps: [{ id: 's1', action: 'fill', description: 'create', locator: { strategy: 'css', value: '#name' }, value: 'demo' }],
      cleanup: [{ id: 'c1', action: 'evaluate', description: 'remove', expression: 'cleanupDemo()', cleanup: true }],
    });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'mutate-without-cleanup')).toBe(false);
  });

  it('rejects an unapproved URL when an allowlist is supplied', () => {
    const context: SpecValidationContext = { baseUrl: 'https://example.com', allowedHosts: ['example.com'] };
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'navigate', description: 'evil', url: 'https://evil.example.net/page' }],
    });
    const result = validateControlledSpec(spec, context);
    expect(result.errors.some((e) => e.code === 'unapproved-url')).toBe(true);
  });

  it('does not flag URLs when no allowlist is configured', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'navigate', description: 'external', url: 'https://anything.test/page' }],
    });
    const result = validateControlledSpec(spec);
    expect(result.errors.some((e) => e.code === 'unapproved-url')).toBe(false);
  });

  it('warns on fragile CSS locators', () => {
    const spec = baseSpec({
      steps: [{ id: 's1', action: 'click', description: 'click', locator: { strategy: 'css', value: '#submit' } }],
    });
    const result = validateControlledSpec(spec);
    expect(result.warnings.some((w) => w.code === 'fragile-locator')).toBe(true);
  });

  it('warns when the spec has no assertions', () => {
    const spec = baseSpec({ steps: [{ id: 's1', action: 'navigate', description: 'open', url: 'https://example.com/' }] });
    const result = validateControlledSpec(spec);
    expect(result.warnings.some((w) => w.code === 'no-assertions')).toBe(true);
  });

  it('warns when only existence assertions are used', () => {
    const spec = baseSpec({
      steps: [
        { id: 's1', action: 'assert', description: 'visible', assertion: 'visible', locator: { strategy: 'css', value: '#x' } },
        { id: 's2', action: 'assert', description: 'enabled', assertion: 'enabled', locator: { strategy: 'css', value: '#y' } },
      ],
    });
    const result = validateControlledSpec(spec);
    expect(result.warnings.some((w) => w.code === 'weakened-assertion')).toBe(true);
  });

  it('exposes issue codes via helper', () => {
    const set = codes(baseSpec({ risk: 'mutate' }));
    expect(set.has('mutate-without-cleanup')).toBe(true);
  });
});
