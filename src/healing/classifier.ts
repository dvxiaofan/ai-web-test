import type { EvidenceRef, ScenarioResult, StepResult } from '../core/types.js';
import type { ClassifierInput, FailureCategory, FailureClassification } from './types.js';

/**
 * Deterministic failure classification (Phase 6).
 *
 * Rules are ordered from most to least specific. Each rule inspects only the
 * recorded run evidence (step errors, assertion results, runtime metadata),
 * never external state, so the same RunResult always classifies the same way.
 */
export function classifyFailure(input: ClassifierInput): FailureClassification | undefined {
  const { scenario } = input;
  if (scenario.status === 'passed' || scenario.status === 'skipped') return undefined;

  const failedStep = findFailedStep(scenario);
  const errorText = collectErrorText(scenario, failedStep).toLowerCase();
  const metadata = (scenario.metadata ?? {}) as Record<string, unknown>;
  const evidence = buildEvidence(scenario, failedStep);

  const finish = (category: FailureCategory, confidence: number, reasons: string[]): FailureClassification => ({
    scenarioId: scenario.scenarioId,
    stepId: failedStep?.stepId,
    category,
    confidence,
    reasons,
    evidence,
  });

  // 1. Cleanup — executor marks this explicitly; highest priority because it
  // must never be masked by other categories.
  if (metadata.cleanupFailed === true) {
    return finish('cleanup', 0.95, ['Executor marked a teardown/cleanup step as failed (metadata.cleanupFailed).']);
  }

  // 2. Browser infrastructure — crashes and disconnects before test logic.
  if (matches(errorText, ['browser has been closed', 'browser closed', 'target crashed', 'browsertype.launch', 'browser disconnected', 'executable doesn\'t exist'])) {
    return finish('browser-infrastructure', 0.9, ['Error text indicates a browser launch/crash/disconnect problem.']);
  }

  // 3. Authentication — login/session failures.
  if (matches(errorText, ['login failed', 'authentication', 'unauthorized', 'not logged in', 'session expired', 'sign in', 'csrf'])
    || hasFailedRequestWithStatus(metadata, [401])) {
    return finish('authentication', 0.85, ['Evidence contains authentication/session failure markers (error text or HTTP 401).']);
  }

  // 4. Permission — authenticated but access denied.
  if (matches(errorText, ['forbidden', 'permission denied', 'access denied', 'not allowed for role'])
    || hasFailedRequestWithStatus(metadata, [403])) {
    return finish('permission', 0.85, ['Evidence contains authorization failure markers (error text or HTTP 403).']);
  }

  // 5. Navigation — page-level load failures.
  if ((failedStep?.action === 'navigate')
    || matches(errorText, ['net::err_name_not_resolved', 'net::err_connection_refused', 'navigation timeout', 'page.goto', 'err_aborted'])) {
    const reasons = failedStep?.action === 'navigate'
      ? ['The failing step is a navigate action.']
      : ['Error text indicates a page navigation/load failure.'];
    return finish('navigation', 0.85, reasons);
  }

  // 6. Test data — records missing/duplicated, seeded state absent.
  if (matches(errorText, ['no such record', 'record not found', 'duplicate entry', 'already exists', 'test data', 'fixture', 'seed'])) {
    return finish('test-data', 0.75, ['Error text references missing/duplicate records or fixtures.']);
  }

  // 7. Locator — element resolution failures.
  if (matches(errorText, ['locator', 'selector', 'element is not attached', 'element not found', 'strict mode violation', 'waiting for locator', 'no element matches'])) {
    return finish('locator', 0.85, ['Error text indicates the target element could not be resolved.']);
  }

  // 8. Assertion — an assert step failed with a resolved element.
  if (failedStep?.action === 'assert' || failedStep?.assertions.some((assertion) => assertion.status === 'failed')) {
    return finish('assertion', 0.9, ['The failing step is an assertion whose comparison did not hold.']);
  }

  // 9. API — backend responses failing while the page itself worked.
  if (hasFailedRequestWithStatus(metadata, [500, 502, 503, 504]) || matches(errorText, ['internal server error', 'bad gateway', 'service unavailable'])) {
    return finish('api', 0.8, ['Runtime evidence contains 5xx backend responses.']);
  }

  // 10. Environment — timeouts and infrastructure flakiness fallback.
  return finish('environment', 0.4, ['No specific rule matched; defaulting to environment with low confidence.']);
}

/** Classify every failed scenario of a run in one pass. */
export function classifyRunFailures(scenarios: ScenarioResult[]): FailureClassification[] {
  const classifications: FailureClassification[] = [];
  for (const scenario of scenarios) {
    const classification = classifyFailure({ scenario });
    if (classification) classifications.push(classification);
  }
  return classifications;
}

function findFailedStep(scenario: ScenarioResult): StepResult | undefined {
  return scenario.steps.find((step) => step.status === 'failed' || step.status === 'error' || step.status === 'blocked');
}

function collectErrorText(scenario: ScenarioResult, failedStep: StepResult | undefined): string {
  const parts: string[] = [];
  if (failedStep?.error) parts.push(`${failedStep.error.name}: ${failedStep.error.message}`);
  if (scenario.error) parts.push(`${scenario.error.name}: ${scenario.error.message}`);
  const metadata = (scenario.metadata ?? {}) as Record<string, unknown>;
  for (const key of ['pageErrors', 'consoleErrors'] as const) {
    const values = metadata[key];
    if (Array.isArray(values)) parts.push(...values.filter((value): value is string => typeof value === 'string').slice(0, 10));
  }
  return parts.join('\n');
}

function matches(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function hasFailedRequestWithStatus(metadata: Record<string, unknown>, statuses: number[]): boolean {
  const failedRequests = metadata.failedRequests;
  if (!Array.isArray(failedRequests)) return false;
  return failedRequests.some((entry) => {
    if (typeof entry === 'string') return statuses.some((status) => entry.includes(` ${status} `) || entry.endsWith(` ${status}`) || entry.includes(`(${status})`) || entry.includes(` ${status})`));
    if (entry && typeof entry === 'object') {
      const status = (entry as Record<string, unknown>).status;
      return typeof status === 'number' && statuses.includes(status);
    }
    return false;
  });
}

function buildEvidence(scenario: ScenarioResult, failedStep: StepResult | undefined): EvidenceRef[] {
  const observedAt = scenario.endedAt ?? scenario.startedAt;
  const evidence: EvidenceRef[] = [];
  let seq = 0;
  const push = (summary: string): void => {
    seq += 1;
    evidence.push({ id: `classify-${scenario.scenarioId}-${seq}`, kind: 'runtime', summary, confidence: 1, observedAt });
  };
  if (failedStep?.error) push(`step ${failedStep.stepId} ${failedStep.status}: ${failedStep.error.message}`.slice(0, 300));
  else if (scenario.error) push(`scenario error: ${scenario.error.message}`.slice(0, 300));
  const metadata = (scenario.metadata ?? {}) as Record<string, unknown>;
  const failedRequests = metadata.failedRequests;
  if (Array.isArray(failedRequests) && failedRequests.length > 0) {
    push(`failed requests: ${failedRequests.slice(0, 3).map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('; ')}`.slice(0, 300));
  }
  if (metadata.cleanupFailed === true) push('cleanup step failed (metadata.cleanupFailed=true)');
  return evidence;
}
