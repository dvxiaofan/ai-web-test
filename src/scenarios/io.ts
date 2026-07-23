import {
  readJsonFile,
  writeJsonFile,
  type ActionRisk,
  type JsonObject,
  type JsonValue,
  type LocatorTarget,
  type ScenarioStep,
  type TestScenario,
} from '../core/index.js';

const ACTIONS = new Set([
  'navigate',
  'click',
  'fill',
  'select-option',
  'check',
  'uncheck',
  'press',
  'wait',
  'assert',
  'screenshot',
  'evaluate',
]);
const RISKS = new Set(['read', 'mutate', 'destructive']);
const SOURCES = new Set(['generated', 'user', 'discovered', 'imported']);
const LOCATOR_STRATEGIES = new Set([
  'role',
  'label',
  'text',
  'testId',
  'placeholder',
  'css',
  'xpath',
  'url',
  'relative',
]);
const ASSERTIONS = new Set([
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'text',
  'value',
  'url',
  'count',
  'attribute',
  'status',
]);
const COMPARATORS = new Set(['equals', 'contains', 'matches', 'greater-than', 'less-than']);
const WAIT_MODES = new Set(['load-state', 'network-idle', 'selector']);

/** A malformed scenario is an input/configuration error, never a test result. */
export class ScenarioValidationError extends Error {
  readonly location: string;

  constructor(location: string, message: string) {
    super(`${location}: ${message}`);
    this.name = 'ScenarioValidationError';
    this.location = location;
  }
}

export async function loadScenarios(filePath: string): Promise<TestScenario[]> {
  const value = await readJsonFile<unknown>(filePath);
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.scenarios)
      ? value.scenarios
      : undefined;
  if (!candidates) throw new Error(`Scenario file ${filePath} must contain an array or { scenarios: [] }.`);

  if (isRecord(value)) {
    requireExactVersion(value.schemaVersion, `${filePath}.schemaVersion`);
    if (value.generatedAt !== undefined) validateDate(value.generatedAt, `${filePath}.generatedAt`);
  }

  const scenarios = candidates.map((candidate, index) => validateScenario(candidate, `${filePath}.scenarios[${index}]`));
  const ids = new Set<string>();
  for (const [index, scenario] of scenarios.entries()) {
    if (ids.has(scenario.id)) {
      throw new ScenarioValidationError(`${filePath}.scenarios[${index}].id`, `duplicate scenario id '${scenario.id}'.`);
    }
    ids.add(scenario.id);
  }
  return scenarios;
}

export async function writeScenarios(filePath: string, scenarios: TestScenario[]): Promise<void> {
  // Validate at the serialization boundary too. This keeps generated and
  // user-authored catalogs subject to exactly the same runtime contract.
  const checked = scenarios.map((scenario, index) => validateScenario(scenario, `${filePath}.scenarios[${index}]`));
  const ids = new Set<string>();
  for (const [index, scenario] of checked.entries()) {
    if (ids.has(scenario.id)) {
      throw new ScenarioValidationError(`${filePath}.scenarios[${index}].id`, `duplicate scenario id '${scenario.id}'.`);
    }
    ids.add(scenario.id);
  }
  await writeJsonFile(filePath, { schemaVersion: 1, generatedAt: new Date().toISOString(), scenarios: checked });
}

/** Validate one untrusted scenario and return it only after all runtime checks pass. */
export function validateScenario(value: unknown, location = 'scenario'): TestScenario {
  if (!isRecord(value)) fail(location, 'expected an object.');
  requireExactVersion(value.schemaVersion, `${location}.schemaVersion`);
  requireNonEmptyString(value.id, `${location}.id`);
  requireNonEmptyString(value.name, `${location}.name`);
  requireEnum(value.source, SOURCES, `${location}.source`);
  requireRisk(value.risk, `${location}.risk`);
  requireConfidence(value.confidence, `${location}.confidence`);
  validateStringArray(value.moduleIds, `${location}.moduleIds`);
  validateStringArray(value.routeIds, `${location}.routeIds`);
  validateStringArray(value.operationIds, `${location}.operationIds`);
  validateStringArray(value.roleIds, `${location}.roleIds`);
  validateStringArray(value.tags, `${location}.tags`);
  validateStringArray(value.prerequisites, `${location}.prerequisites`, true);
  validateEvidenceArray(value.evidence, `${location}.evidence`);
  validateDate(value.createdAt, `${location}.createdAt`);
  if (value.updatedAt !== undefined) validateDate(value.updatedAt, `${location}.updatedAt`);
  if (value.description !== undefined) requireString(value.description, `${location}.description`);
  if (value.metadata !== undefined) validateJsonObject(value.metadata, `${location}.metadata`);

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    fail(`${location}.steps`, 'must be a non-empty array.');
  }
  const stepIds = new Set<string>();
  let highestStepRisk: ActionRisk = 'read';
  for (const [index, rawStep] of value.steps.entries()) {
    const stepLocation = `${location}.steps[${index}]`;
    const step = validateStep(rawStep, stepLocation);
    if (stepIds.has(step.id)) fail(`${stepLocation}.id`, `duplicate step id '${step.id}'.`);
    stepIds.add(step.id);

    const minimumRisk = minimumRiskForStep(step);
    if (riskRank(step.risk) < riskRank(minimumRisk)) {
      fail(`${stepLocation}.risk`, `action '${step.action}' requires at least '${minimumRisk}' risk (declared '${step.risk}').`);
    }
    const effectiveRisk = riskRank(step.risk) >= riskRank(minimumRisk) ? step.risk : minimumRisk;
    if (riskRank(effectiveRisk) > riskRank(highestStepRisk)) highestStepRisk = effectiveRisk;
  }
  if (riskRank(value.risk) < riskRank(highestStepRisk)) {
    fail(`${location}.risk`, `scenario risk '${value.risk}' is below required step risk '${highestStepRisk}'.`);
  }

  return value as unknown as TestScenario;
}

/** The conservative minimum risk implied by an action, independent of AI/user labels. */
export function minimumRiskForStep(step: ScenarioStep): ActionRisk {
  switch (step.action) {
    case 'fill':
    case 'select-option':
    case 'check':
    case 'uncheck':
    case 'press':
      return 'mutate';
    case 'click':
      // A URL locator explicitly identifies navigation. All other clicks may
      // submit, toggle, or otherwise mutate application state.
      return step.locator.strategy === 'url' ? 'read' : 'mutate';
    case 'evaluate':
      // Arbitrary page JavaScript can perform any side effect.
      return 'destructive';
    case 'navigate':
    case 'wait':
    case 'assert':
    case 'screenshot':
      return 'read';
    default:
      throw new Error(`Unsupported scenario action: ${String((step as { action?: unknown }).action)}`);
  }
}

function validateStep(value: unknown, location: string): ScenarioStep {
  if (!isRecord(value)) fail(location, 'expected an object.');
  requireNonEmptyString(value.id, `${location}.id`);
  requireEnum(value.action, ACTIONS, `${location}.action`);
  requireRisk(value.risk, `${location}.risk`);
  if (value.name !== undefined) requireString(value.name, `${location}.name`);
  if (value.timeoutMs !== undefined) requirePositiveInteger(value.timeoutMs, `${location}.timeoutMs`);
  if (value.locator !== undefined) validateLocator(value.locator, `${location}.locator`);
  if (value.metadata !== undefined) validateJsonObject(value.metadata, `${location}.metadata`);

  switch (value.action) {
    case 'navigate':
      requireNonEmptyString(value.url, `${location}.url`);
      if (value.waitUntil !== undefined) requireEnum(value.waitUntil, new Set(['load', 'domcontentloaded', 'networkidle', 'commit']), `${location}.waitUntil`);
      break;
    case 'click':
      validateLocator(value.locator, `${location}.locator`);
      if (value.button !== undefined) requireEnum(value.button, new Set(['left', 'middle', 'right']), `${location}.button`);
      if (value.clickCount !== undefined) requirePositiveInteger(value.clickCount, `${location}.clickCount`);
      break;
    case 'fill':
      validateLocator(value.locator, `${location}.locator`);
      requireString(value.value, `${location}.value`);
      if (value.sensitive !== undefined) requireBoolean(value.sensitive, `${location}.sensitive`);
      break;
    case 'select-option':
      validateLocator(value.locator, `${location}.locator`);
      if (typeof value.value !== 'string' && !(Array.isArray(value.value) && value.value.every((item) => typeof item === 'string'))) {
        fail(`${location}.value`, 'must be a string or an array of strings.');
      }
      break;
    case 'check':
    case 'uncheck':
      validateLocator(value.locator, `${location}.locator`);
      break;
    case 'press':
      validateLocator(value.locator, `${location}.locator`);
      requireNonEmptyString(value.key, `${location}.key`);
      break;
    case 'wait': {
      if (value.durationMs !== undefined) requireNonNegativeInteger(value.durationMs, `${location}.durationMs`);
      if (value.for !== undefined) requireEnum(value.for, WAIT_MODES, `${location}.for`);
      if (value.for === 'selector') validateLocator(value.locator, `${location}.locator`);
      if (value.durationMs === undefined && value.for === undefined) fail(location, 'wait requires durationMs or for.');
      break;
    }
    case 'assert':
      requireEnum(value.assertion, ASSERTIONS, `${location}.assertion`);
      if (value.locator !== undefined) validateLocator(value.locator, `${location}.locator`);
      if (value.comparator !== undefined) requireEnum(value.comparator, COMPARATORS, `${location}.comparator`);
      if (value.attribute !== undefined) requireNonEmptyString(value.attribute, `${location}.attribute`);
      validateAssertionFields(value, location);
      break;
    case 'screenshot':
      if (value.name !== undefined) requireString(value.name, `${location}.name`);
      if (value.fullPage !== undefined) requireBoolean(value.fullPage, `${location}.fullPage`);
      if (value.baselineKey !== undefined) requireNonEmptyString(value.baselineKey, `${location}.baselineKey`);
      break;
    case 'evaluate':
      requireNonEmptyString(value.expression, `${location}.expression`);
      break;
    default:
      // Keep a runtime guard even though TypeScript's discriminated union makes
      // this branch unreachable for typed callers.
      fail(`${location}.action`, `unsupported action '${String(value.action)}'.`);
  }
  return value as unknown as ScenarioStep;
}

function validateAssertionFields(value: Record<string, unknown>, location: string): void {
  const assertion = value.assertion;
  const locatorRequired = new Set(['visible', 'hidden', 'enabled', 'disabled', 'text', 'value', 'count', 'attribute']);
  if (typeof assertion === 'string' && locatorRequired.has(assertion)) {
    validateLocator(value.locator, `${location}.locator`);
  }
  if (assertion === 'attribute') requireNonEmptyString(value.attribute, `${location}.attribute`);
  if (['text', 'value', 'url', 'count', 'attribute', 'status'].includes(String(assertion)) && !('expected' in value)) {
    fail(`${location}.expected`, `is required for ${String(assertion)} assertions.`);
  }
  if ('expected' in value && !isJsonValue(value.expected)) fail(`${location}.expected`, 'must be JSON-compatible.');
}

function validateLocator(value: unknown, location: string): asserts value is LocatorTarget {
  if (!isRecord(value)) fail(location, 'is required and must be an object.');
  requireEnum(value.strategy, LOCATOR_STRATEGIES, `${location}.strategy`);
  requireNonEmptyString(value.value, `${location}.value`);
  if (value.name !== undefined) requireString(value.name, `${location}.name`);
  if (value.exact !== undefined) requireBoolean(value.exact, `${location}.exact`);
  if (value.nth !== undefined) requireNonNegativeInteger(value.nth, `${location}.nth`);
}

function validateEvidenceArray(value: unknown, location: string): void {
  if (!Array.isArray(value)) fail(location, 'must be an array.');
  for (const [index, item] of value.entries()) {
    const itemLocation = `${location}[${index}]`;
    if (!isRecord(item)) fail(itemLocation, 'must be an object.');
    requireNonEmptyString(item.id, `${itemLocation}.id`);
    requireEnum(item.kind, new Set(['source', 'runtime', 'operator', 'ai', 'artifact']), `${itemLocation}.kind`);
    requireNonEmptyString(item.summary, `${itemLocation}.summary`);
    requireConfidence(item.confidence, `${itemLocation}.confidence`);
    if (item.observedAt !== undefined) validateDate(item.observedAt, `${itemLocation}.observedAt`);
    if (item.uri !== undefined) requireString(item.uri, `${itemLocation}.uri`);
    if (item.artifactPath !== undefined) requireString(item.artifactPath, `${itemLocation}.artifactPath`);
    if (item.metadata !== undefined) validateJsonObject(item.metadata, `${itemLocation}.metadata`);
    if (item.source !== undefined) {
      if (!isRecord(item.source)) fail(`${itemLocation}.source`, 'must be an object.');
      requireNonEmptyString(item.source.filePath, `${itemLocation}.source.filePath`);
      for (const key of ['line', 'column', 'endLine', 'endColumn'] as const) {
        if (item.source[key] !== undefined) requirePositiveInteger(item.source[key], `${itemLocation}.source.${key}`);
      }
    }
  }
}

function validateStringArray(value: unknown, location: string, optional = false): void {
  if (value === undefined && optional) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    fail(location, 'must be an array of non-empty strings.');
  }
}

function validateJsonObject(value: unknown, location: string): asserts value is JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) fail(location, 'must be a JSON object.');
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (isRecord(value)) return Object.values(value).every((item) => isJsonValue(item));
  return false;
}

function requireExactVersion(value: unknown, location: string): void {
  if (value !== 1) fail(location, 'must be exactly 1.');
}

function requireRisk(value: unknown, location: string): asserts value is ActionRisk {
  requireEnum(value, RISKS, location);
}

function requireEnum(value: unknown, allowed: ReadonlySet<string>, location: string): void {
  if (typeof value !== 'string' || !allowed.has(value)) fail(location, `has unsupported value '${String(value)}'.`);
}

function requireString(value: unknown, location: string): asserts value is string {
  if (typeof value !== 'string') fail(location, 'must be a string.');
}

function requireNonEmptyString(value: unknown, location: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(location, 'must be a non-empty string.');
}

function requireBoolean(value: unknown, location: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(location, 'must be a boolean.');
}

function requirePositiveInteger(value: unknown, location: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail(location, 'must be a positive safe integer.');
}

function requireNonNegativeInteger(value: unknown, location: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(location, 'must be a non-negative safe integer.');
}

function requireConfidence(value: unknown, location: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(location, 'must be a number between 0 and 1.');
}

function validateDate(value: unknown, location: string): asserts value is string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(location, 'must be a valid ISO date-time string.');
}

function riskRank(risk: ActionRisk): number {
  return risk === 'read' ? 0 : risk === 'mutate' ? 1 : 2;
}

function fail(location: string, message: string): never {
  throw new ScenarioValidationError(location, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
