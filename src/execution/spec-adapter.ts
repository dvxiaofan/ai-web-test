import type { ActionRisk, ScenarioStep, TestScenario } from '../core/index.js';
import { validateScenario } from '../scenarios/io.js';
import { CONTROLLED_SPEC_SOURCE, type ControlledSpec, type ControlledSpecStep } from './spec-types.js';

/** Thrown when a Controlled Spec carries a (reasoned) skip and therefore must not be executed. */
export class SpecSkippedError extends Error {
  readonly reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.name = 'SpecSkippedError';
    this.reason = reason;
  }
}

const RISK_RANK: Record<ActionRisk, number> = { read: 0, mutate: 1, destructive: 2 };

/** Conservative minimum risk implied by a step action, mirroring scenarios/io `minimumRiskForStep`. */
function minimumRiskForAction(step: ControlledSpecStep): ActionRisk {
  switch (step.action) {
    case 'fill':
    case 'select-option':
    case 'check':
    case 'uncheck':
    case 'press':
      return 'mutate';
    case 'click':
      return step.locator?.strategy === 'url' ? 'read' : 'mutate';
    case 'evaluate':
      return 'destructive';
    case 'navigate':
    case 'wait':
    case 'assert':
    case 'screenshot':
      return 'read';
  }
}

function mapStep(step: ControlledSpecStep): ScenarioStep {
  const base: Record<string, unknown> = {
    id: step.id,
    action: step.action,
    risk: minimumRiskForAction(step),
    description: step.description,
  };
  if (step.name) base.name = step.name;
  if (step.timeoutMs !== undefined) base.timeoutMs = step.timeoutMs;
  if (step.locator) base.locator = step.locator;
  if (step.value !== undefined) base.value = step.value;
  if (step.url) base.url = step.url;
  if (step.expression) base.expression = step.expression;
  if (step.method) base.method = step.method;
  if (step.headers) base.headers = step.headers;
  if (step.body !== undefined) base.body = step.body;
  if (step.expectStatusCode !== undefined) base.expectStatusCode = step.expectStatusCode;
  if (step.waitUntil) base.waitUntil = step.waitUntil;
  if (step.assertion) base.assertion = step.assertion;
  if (step.expected !== undefined) base.expected = step.expected;
  if (step.comparator) base.comparator = step.comparator;
  if (step.attribute) base.attribute = step.attribute;
  if (step.cleanup) {
    base.metadata = { ...(step.metadata ?? {}), cleanup: true };
  } else if (step.metadata) {
    base.metadata = step.metadata;
  }
  return base as unknown as ScenarioStep;
}

/**
 * Adapt a Controlled Spec into the canonical `TestScenario` (DSL) shape so it
 * runs through the same `executePlan` runtime as generated scenarios. Cleanup
 * steps are appended as teardown steps tagged `metadata.cleanup: true`, which
 * lets the executor attribute cleanup failures separately in the report.
 *
 * Governance checks live in `spec-validator`; this function only performs the
 * structural translation and the standard scenario contract check.
 */
export function adaptControlledSpecToScenario(spec: ControlledSpec): TestScenario {
  if (spec.skip) {
    throw new SpecSkippedError(`Spec ${spec.id} is skipped and must not be executed: ${spec.skip.reason}`, spec.skip.reason);
  }

  const rawSteps = [...spec.steps, ...(spec.cleanup ?? [])];
  const mapped = rawSteps.map(mapStep);
  const highest = mapped.reduce<ActionRisk>(
    (acc, step) => (RISK_RANK[step.risk] > RISK_RANK[acc] ? step.risk : acc),
    'read',
  );

  const scenario = {
    schemaVersion: 1,
    id: spec.id,
    name: spec.name,
    source: CONTROLLED_SPEC_SOURCE,
    risk: highest,
    confidence: 0.9,
    moduleIds: spec.moduleIds,
    routeIds: spec.routeIds,
    operationIds: [] as string[],
    roleIds: spec.roleIds,
    tags: spec.tags,
    prerequisites: [] as string[],
    evidence: [] as TestScenario['evidence'],
    createdAt: spec.createdAt,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    metadata: { controlled: true, specId: spec.id },
    steps: mapped,
  };

  return validateScenario(scenario, `spec:${spec.id}`);
}
