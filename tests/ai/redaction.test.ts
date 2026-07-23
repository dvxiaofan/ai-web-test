import { describe, expect, it } from 'vitest';

import { boundAiContext, redactSecrets, redactText } from '../../src/ai/index.js';

describe('AI context redaction', () => {
  it('redacts secret fields and bearer tokens without changing ordinary data', () => {
    expect(redactText('Authorization: Bearer abc.def')).toContain('[REDACTED]');
    expect(redactSecrets({ user: 'qa', password: 'secret', nested: { accessToken: 'token' } })).toEqual({
      user: 'qa', password: '[REDACTED]', nested: { accessToken: '[REDACTED]' },
    });
  });

  it('bounds oversized context without emitting invalid JSON fragments', () => {
    const bounded = boundAiContext({ routes: ['x'.repeat(4_000)] }, 1_000);
    expect(bounded.truncated).toBe(true);
    expect(bounded.originalChars).toBeGreaterThan(bounded.maxContextChars);
    expect(bounded.value).toMatchObject({ _aiWebTestContextTruncated: true });
    expect(() => JSON.stringify(bounded.value)).not.toThrow();
  });

  it('redacts assignment-style secrets in source text', () => {
    expect(redactText('const apiKey = "sk-test-value";')).toContain('[REDACTED]');
  });
});
