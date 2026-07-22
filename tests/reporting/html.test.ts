import { describe, expect, it } from 'vitest';

import { renderHtmlReport } from '../../src/reporting/index.js';

describe('HTML report', () => {
  it('escapes untrusted test content and includes coverage', () => {
    const html = renderHtmlReport({
      projectName: '<shop>', runId: 'run-1', startedAt: 'start', finishedAt: 'finish', planId: 'plan-1',
      summary: { passed: 1, failed: 0, skipped: 0, blocked: 0 },
      coverage: [{ name: 'Routes', discovered: 1, covered: 1 }],
      results: [{ id: 'test-1', name: '<script>alert(1)</script>', status: 'passed' }],
      warnings: [], uncovered: [],
    });
    expect(html).toContain('&lt;shop&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Routes');
  });
});
