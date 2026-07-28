import type { ConsoleMessage, Page, Request } from 'playwright';
import type { EvidenceRef } from '../core/index.js';

export interface EvidenceCollectorOptions {
  redactFields?: string[];
}

/** Minimal shape collected by the executor's runtime evidence mechanism. */
export interface RuntimeEvidenceSnapshot {
  consoleErrors?: string[];
  pageErrors?: string[];
  failedRequests?: Array<{ method: string; url: string; status?: number; error?: string }>;
}

const DEFAULT_REDACT_FIELDS = [
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'password',
  'secret',
  'apikey',
  'api_key',
];

function redact(text: string, fields: string[]): string {
  let output = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|pk_live_|pk_test_)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  for (const field of fields) {
    if (!field.trim()) continue;
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`(${escaped}\\s*[:=]\\s*)([^\\s,;]+)`, 'gi'), '$1[REDACTED]');
  }
  return output;
}

/**
 * Independent, reusable browser-evidence collector. It hooks into a Playwright
 * `Page` and records console errors, page errors and failed requests as
 * redacted `EvidenceRef`s. Used by the executor for controlled specs and is
 * also available to MCP / CI pre-flight and standalone cleanup verification.
 */
export class EvidenceCollector {
  private collected: EvidenceRef[] = [];
  private detachFns: Array<() => void> = [];
  private redactFields: string[];
  private seq = 0;

  constructor(options: EvidenceCollectorOptions = {}) {
    this.redactFields = options.redactFields ?? DEFAULT_REDACT_FIELDS;
  }

  private push(kind: EvidenceRef['kind'], summary: string, confidence: EvidenceRef['confidence'] = 1): void {
    this.seq += 1;
    this.collected.push({
      id: `evidence-${this.seq}`,
      kind,
      summary: redact(summary, this.redactFields),
      confidence,
      observedAt: new Date().toISOString(),
    });
  }

  attach(page: Page): void {
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === 'error') this.push('runtime', `console.error: ${message.text()}`);
    };
    const onPageError = (error: Error) => this.push('runtime', `pageerror: ${error.message}`);
    const onRequestFailed = (request: Request) => {
      const failure = request.failure()?.errorText;
      this.push('runtime', `request failed: ${request.method()} ${request.url()}${failure ? ` (${failure})` : ''}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    this.detachFns.push(() => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
    });
  }

  /** Record a teardown/cleanup failure as a distinct evidence entry. */
  markCleanupFailure(summary: string): void {
    this.push('operator', `cleanup-failure: ${summary}`);
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
  }

  records(): EvidenceRef[] {
    return this.collected;
  }
}

/** Convert the executor's `RuntimeExecutionEvidence` snapshot into canonical `EvidenceRef`s (redacted). */
export function toEvidenceRefs(snapshot: RuntimeEvidenceSnapshot): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  let seq = 0;
  const add = (summary: string) => {
    seq += 1;
    refs.push({
      id: `evidence-${seq}`,
      kind: 'runtime',
      summary: redact(summary, DEFAULT_REDACT_FIELDS),
      confidence: 1,
      observedAt: new Date().toISOString(),
    });
  };
  for (const message of snapshot.consoleErrors ?? []) add(`console.error: ${message}`);
  for (const message of snapshot.pageErrors ?? []) add(`pageerror: ${message}`);
  for (const request of snapshot.failedRequests ?? []) {
    add(`request failed: ${request.method} ${request.url}${request.error ? ` (${request.error})` : ''}${request.status !== undefined ? ` [${request.status}]` : ''}`);
  }
  return refs;
}
