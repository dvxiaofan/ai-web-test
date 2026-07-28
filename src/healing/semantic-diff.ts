import type { AssertStep, LocatorTarget, ScenarioStep, TestScenario } from '../core/types.js';
import type { SemanticChange, SemanticDiff } from './types.js';

const RISK_RANK: Record<string, number> = { read: 0, low: 1, medium: 2, high: 3, destructive: 4 };

/**
 * Compute the semantic diff between an existing scenario and a proposed
 * replacement (Phase 6). Steps are matched by id; the diff describes intent
 * changes (assertions weakened, steps dropped, hosts expanded, ...) rather
 * than raw text differences, so the healing policy can reason about them.
 */
export function diffScenarios(before: TestScenario, after: TestScenario): SemanticDiff {
  const changes: SemanticChange[] = [];

  diffScenarioLevel(before, after, changes);
  diffSteps(before, after, changes);

  return { scenarioId: before.id, changes, identical: changes.length === 0 };
}

function diffScenarioLevel(before: TestScenario, after: TestScenario, changes: SemanticChange[]): void {
  const beforeRoles = new Set(before.roleIds);
  const afterRoles = new Set(after.roleIds);
  if (!sameSet(beforeRoles, afterRoles)) {
    changes.push({
      kind: 'role-changed',
      summary: `Scenario roles changed from [${[...beforeRoles].join(', ')}] to [${[...afterRoles].join(', ')}].`,
      before: [...beforeRoles].join(','),
      after: [...afterRoles].join(','),
    });
  }

  if ((RISK_RANK[after.risk] ?? 0) > (RISK_RANK[before.risk] ?? 0)) {
    changes.push({
      kind: 'risk-increased',
      summary: `Scenario risk increased from ${before.risk} to ${after.risk}.`,
      before: before.risk,
      after: after.risk,
    });
  }

  const beforeHosts = collectHosts(before.steps);
  const afterHosts = collectHosts(after.steps);
  const newHosts = [...afterHosts].filter((host) => !beforeHosts.has(host));
  if (newHosts.length > 0) {
    changes.push({
      kind: 'host-expanded',
      summary: `Scenario now reaches new hosts: ${newHosts.join(', ')}.`,
      before: [...beforeHosts].join(','),
      after: [...afterHosts].join(','),
    });
  }

  const beforeStrategy = testDataStrategy(before);
  const afterStrategy = testDataStrategy(after);
  if (beforeStrategy !== afterStrategy) {
    changes.push({
      kind: 'test-data-strategy-changed',
      summary: `Test data strategy changed from ${beforeStrategy ?? '(none)'} to ${afterStrategy ?? '(none)'}.`,
      before: beforeStrategy ?? '(none)',
      after: afterStrategy ?? '(none)',
    });
  }

  if (metadataFlag(after, 'skip') && !metadataFlag(before, 'skip')) {
    changes.push({ kind: 'skip-added', summary: 'The proposed scenario is marked as skipped.' });
  }
  if (metadataFlag(before, 'guard') && !metadataFlag(after, 'guard')) {
    changes.push({ kind: 'guard-disabled', summary: 'A guard flag present on the original scenario was removed.' });
  }
}

function diffSteps(before: TestScenario, after: TestScenario, changes: SemanticChange[]): void {
  const afterById = new Map(after.steps.map((step) => [step.id, step]));

  for (const beforeStep of before.steps) {
    const afterStep = afterById.get(beforeStep.id);
    if (!afterStep) {
      const isCleanup = beforeStep.metadata !== undefined && (beforeStep.metadata as Record<string, unknown>).cleanup === true;
      if (isCleanup) {
        changes.push({
          kind: 'cleanup-removed',
          stepId: beforeStep.id,
          summary: `Cleanup step ${beforeStep.id} was removed.`,
        });
      } else if (beforeStep.action === 'assert') {
        changes.push({
          kind: 'assertion-removed',
          stepId: beforeStep.id,
          summary: `Assertion step ${beforeStep.id} (${(beforeStep as AssertStep).assertion}) was removed.`,
        });
      } else {
        changes.push({ kind: 'step-removed', stepId: beforeStep.id, summary: `Step ${beforeStep.id} (${beforeStep.action}) was removed.` });
      }
      continue;
    }
    diffStepPair(beforeStep, afterStep, changes);
  }

  const beforeIds = new Set(before.steps.map((step) => step.id));
  for (const afterStep of after.steps) {
    if (!beforeIds.has(afterStep.id)) {
      changes.push({ kind: 'step-added', stepId: afterStep.id, summary: `Step ${afterStep.id} (${afterStep.action}) was added.` });
    }
  }
}

function diffStepPair(before: ScenarioStep, after: ScenarioStep, changes: SemanticChange[]): void {
  if (before.action !== after.action) {
    if (before.action === 'assert') {
      changes.push({
        kind: 'assertion-removed',
        stepId: before.id,
        summary: `Assertion step ${before.id} was replaced by a ${after.action} action.`,
        before: before.action,
        after: after.action,
      });
    } else {
      changes.push({
        kind: 'assertion-changed',
        stepId: before.id,
        summary: `Step ${before.id} action changed from ${before.action} to ${after.action}.`,
        before: before.action,
        after: after.action,
      });
    }
    return;
  }

  if (before.action === 'assert' && after.action === 'assert') {
    diffAssertion(before, after, changes);
  }

  if (before.action === 'navigate' && after.action === 'navigate' && before.url !== after.url) {
    const beforeHost = hostOf(before.url);
    const afterHost = hostOf(after.url);
    if (beforeHost === afterHost) {
      changes.push({
        kind: 'url-path-updated',
        stepId: before.id,
        summary: `Navigation URL path changed on the same host (${afterHost ?? 'relative'}).`,
        before: before.url,
        after: after.url,
      });
    } else {
      changes.push({
        kind: 'host-expanded',
        stepId: before.id,
        summary: `Navigation host changed from ${beforeHost ?? '(relative)'} to ${afterHost ?? '(relative)'}.`,
        before: before.url,
        after: after.url,
      });
    }
  }

  if (before.action === 'wait' && after.action === 'wait'
    && (before.durationMs !== after.durationMs || before.for !== after.for)) {
    changes.push({
      kind: 'wait-adjusted',
      stepId: before.id,
      summary: `Wait condition adjusted (${describeWait(before)} → ${describeWait(after)}).`,
      before: describeWait(before),
      after: describeWait(after),
    });
  }

  diffLocator(before, after, changes);
}

function diffAssertion(before: AssertStep, after: AssertStep, changes: SemanticChange[]): void {
  const weakened = isWeakerComparator(before.comparator, after.comparator)
    || (before.expected !== undefined && after.expected === undefined);
  if (weakened) {
    changes.push({
      kind: 'assertion-weakened',
      stepId: before.id,
      summary: `Assertion ${before.id} was weakened (${describeAssert(before)} → ${describeAssert(after)}).`,
      before: describeAssert(before),
      after: describeAssert(after),
    });
    return;
  }
  if (before.assertion !== after.assertion
    || before.comparator !== after.comparator
    || JSON.stringify(before.expected) !== JSON.stringify(after.expected)
    || before.attribute !== after.attribute) {
    changes.push({
      kind: 'assertion-changed',
      stepId: before.id,
      summary: `Assertion ${before.id} semantics changed (${describeAssert(before)} → ${describeAssert(after)}).`,
      before: describeAssert(before),
      after: describeAssert(after),
    });
  }
}

function diffLocator(before: ScenarioStep, after: ScenarioStep, changes: SemanticChange[]): void {
  const beforeLocator = before.locator;
  const afterLocator = after.locator;
  if (!beforeLocator || !afterLocator) return;
  if (JSON.stringify(beforeLocator) === JSON.stringify(afterLocator)) return;

  const kind = classifyLocatorChange(beforeLocator, afterLocator);
  changes.push({
    kind,
    stepId: before.id,
    summary: `Locator of step ${before.id} updated (${describeLocator(beforeLocator)} → ${describeLocator(afterLocator)}).`,
    before: describeLocator(beforeLocator),
    after: describeLocator(afterLocator),
  });
}

function classifyLocatorChange(before: LocatorTarget, after: LocatorTarget): SemanticChange['kind'] {
  if (before.strategy === 'testId' && after.strategy === 'testId') return 'test-id-updated';
  if (before.strategy === 'role' && after.strategy === 'role' && before.value === after.value) {
    // Same role, different accessible name — equivalent-intent rename.
    return 'accessible-name-updated';
  }
  return 'locator-updated';
}

// --- helpers -------------------------------------------------------------

/** Comparator strength order: equals > matches > greater/less-than > contains. */
const COMPARATOR_STRENGTH: Record<string, number> = {
  equals: 3,
  matches: 2,
  'greater-than': 2,
  'less-than': 2,
  contains: 1,
};

function isWeakerComparator(before: AssertStep['comparator'], after: AssertStep['comparator']): boolean {
  if (before === undefined || after === undefined) return false;
  return (COMPARATOR_STRENGTH[after] ?? 0) < (COMPARATOR_STRENGTH[before] ?? 0);
}

function describeAssert(step: AssertStep): string {
  return `${step.assertion}${step.comparator ? ` ${step.comparator}` : ''}${step.expected !== undefined ? ` ${JSON.stringify(step.expected)}` : ''}`;
}

function describeWait(step: Extract<ScenarioStep, { action: 'wait' }>): string {
  return step.for ? `for=${step.for}` : `durationMs=${step.durationMs ?? 0}`;
}

function describeLocator(locator: LocatorTarget): string {
  return JSON.stringify(locator);
}

function collectHosts(steps: ScenarioStep[]): Set<string> {
  const hosts = new Set<string>();
  for (const step of steps) {
    if (step.action === 'navigate') {
      const host = hostOf(step.url);
      if (host) hosts.add(host);
    }
  }
  return hosts;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined; // Relative URLs stay on the configured base host.
  }
}

function testDataStrategy(scenario: TestScenario): string | undefined {
  const value = scenario.metadata !== undefined ? (scenario.metadata as Record<string, unknown>).testDataStrategy : undefined;
  return typeof value === 'string' ? value : undefined;
}

function metadataFlag(scenario: TestScenario, key: string): boolean {
  return scenario.metadata !== undefined && (scenario.metadata as Record<string, unknown>)[key] === true;
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
