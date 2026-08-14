import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { EvidenceCollector, toEvidenceRefs } from '../../src/execution/evidence-collector.js';

function mockPage(): Page {
  return new EventEmitter() as unknown as Page;
}

describe('toEvidenceRefs', () => {
  it('converts a runtime snapshot into redacted EvidenceRefs', () => {
    const refs = toEvidenceRefs({
      consoleErrors: ['console.error: Authorization: Bearer secret-token'],
      pageErrors: ['TypeError: undefined is not a function'],
      failedRequests: [{ method: 'GET', url: 'https://example.com/api', status: 500 }],
    });
    expect(refs.length).toBe(3);
    expect(refs.every((ref) => ref.kind === 'runtime')).toBe(true);
    expect(refs[0]!.summary).not.toContain('secret-token');
    expect(refs[0]!.summary).toContain('[REDACTED]');
  });

  it('handles empty snapshots', () => {
    expect(toEvidenceRefs({})).toEqual([]);
  });
});

describe('EvidenceCollector', () => {
  it('records console errors, page errors and failed requests from a page', () => {
    const page = mockPage();
    const collector = new EvidenceCollector();
    collector.attach(page);
    (page as unknown as EventEmitter).emit('console', { type: () => 'error', text: () => 'Bearer topsecret' });
    (page as unknown as EventEmitter).emit('pageerror', new Error('boom'));
    (page as unknown as EventEmitter).emit('requestfailed', {
      method: () => 'POST',
      url: () => 'https://example.com/x',
      failure: () => ({ errorText: 'net::ERR_FAILED' }),
    });
    const records = collector.records();
    expect(records.length).toBe(3);
    expect(records[0]!.summary).toContain('[REDACTED]');
    expect(records.some((r) => r.summary.startsWith('pageerror:'))).toBe(true);
    expect(records.some((r) => r.summary.startsWith('request failed:'))).toBe(true);
  });

  it('records a cleanup failure distinctly', () => {
    const collector = new EvidenceCollector();
    collector.markCleanupFailure('demo row not removed');
    const records = collector.records();
    expect(records[0]!.kind).toBe('operator');
    expect(records[0]!.summary).toContain('cleanup-failure');
  });

  it('stops collecting after detach', () => {
    const page = mockPage();
    const collector = new EvidenceCollector();
    collector.attach(page);
    collector.detach();
    (page as unknown as EventEmitter).emit('console', { type: () => 'error', text: () => 'ignored' });
    expect(collector.records()).toHaveLength(0);
  });
});
