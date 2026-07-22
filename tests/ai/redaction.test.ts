import { describe, expect, it } from 'vitest';

import { redactSecrets, redactText } from '../../src/ai/index.js';

describe('AI context redaction', () => {
  it('redacts secret fields and bearer tokens without changing ordinary data', () => {
    expect(redactText('Authorization: Bearer abc.def')).toContain('[REDACTED]');
    expect(redactSecrets({ user: 'qa', password: 'secret', nested: { accessToken: 'token' } })).toEqual({
      user: 'qa', password: '[REDACTED]', nested: { accessToken: '[REDACTED]' },
    });
  });
});
