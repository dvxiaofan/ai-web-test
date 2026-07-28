import type { TestPolicy, TestScenario } from '../core/index.js';
import { evaluatePolicy } from '../core/index.js';
import { adaptControlledSpecToScenario } from './spec-adapter.js';
import { validateControlledSpec } from './spec-validator.js';
import type {
  CompiledAction,
  ControlledSpec,
  SpecCompilationResult,
  SpecValidationContext,
  SpecValidationResult,
} from './spec-types.js';

/** Raised when a Controlled Spec fails governance validation and cannot be compiled. */
export class SpecCompilationError extends Error {
  readonly result: SpecValidationResult;
  constructor(message: string, result: SpecValidationResult) {
    super(message);
    this.name = 'SpecCompilationError';
    this.result = result;
  }
}

const URL_PATTERN = /https?:\/\/[^\s'"]+/i;

function extractStepUrl(step: TestScenario['steps'][number]): string | undefined {
  if (typeof step.url === 'string' && step.url.length > 0) return step.url;
  if (typeof step.expression === 'string') {
    const match = step.expression.match(URL_PATTERN);
    if (match) return match[0];
  }
  return undefined;
}

function compileActions(
  scenario: TestScenario,
  descriptions: Map<string, string>,
  policy: TestPolicy,
  baseUrl?: string,
): CompiledAction[] {
  return scenario.steps.map((step) => {
    const url = extractStepUrl(step);
    const decision = evaluatePolicy(
      policy,
      { name: step.action, risk: step.risk, ...(url ? { url } : {}) },
      baseUrl,
    );
    return {
      stepId: step.id,
      action: step.action,
      description: descriptions.get(step.id) ?? step.name ?? step.action,
      risk: step.risk,
      cleanup: step.metadata?.cleanup === true,
      policyAllowed: decision.allowed,
      policyCode: decision.code,
      policyReason: decision.reason,
    };
  });
}

/**
 * Compile an already-validated `TestScenario` (DSL) into pre-checked actions.
 * Runs the same `evaluatePolicy` the runtime uses, so CI/pre-flight can surface
 * policy violations before any browser is launched.
 */
export function compileScenarioActions(scenario: TestScenario, policy: TestPolicy, baseUrl?: string): CompiledAction[] {
  return compileActions(scenario, new Map(), policy, baseUrl);
}

/**
 * Validate (governance) + adapt + policy pre-check a Controlled Spec in one step.
 * Throws `SpecCompilationError` if governance validation fails, otherwise returns
 * the adapted `TestScenario` plus per-step `CompiledAction` records that make
 * every policy decision explicit and auditable.
 */
export function compileControlledSpec(
  spec: ControlledSpec,
  policy: TestPolicy,
  baseUrl?: string,
  context: SpecValidationContext = {},
): SpecCompilationResult {
  const validation = validateControlledSpec(spec, context);
  if (!validation.valid) {
    throw new SpecCompilationError('Controlled Spec failed governance validation.', validation);
  }

  const descriptions = new Map<string, string>();
  for (const step of [...spec.steps, ...(spec.cleanup ?? [])]) {
    descriptions.set(step.id, step.description);
  }

  const scenario = adaptControlledSpecToScenario(spec);
  const actions = compileActions(scenario, descriptions, policy, baseUrl);
  return { spec, scenario, actions };
}
