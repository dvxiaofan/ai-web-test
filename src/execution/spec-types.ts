import type { ActionRisk, JsonValue, LocatorTarget, ScenarioStep } from '../core/index.js';

/**
 * Phase 5B — Controlled Spec data model.
 *
 * A Controlled Spec is the higher-level, governance-aware authoring surface that
 * sits on top of the generated `TestScenario` (DSL). It forbids the same risky
 * constructs at authoring time (see `spec-validator.ts`) and is adapted into a
 * standard `TestScenario` by `spec-adapter.ts`, so both the DSL and the
 * controlled surface execute through the exact same `executePlan` runtime and
 * produce one unified `RunResult`.
 */

export const CONTROLLED_SPEC_SCHEMA_VERSION = 1 as const;
export const CONTROLLED_SPEC_SOURCE = 'imported' as const;

/** A single declarative step inside a Controlled Spec. Mirrors ScenarioStep but every step must carry a human description. */
export interface ControlledSpecStep {
  id: string;
  action: ScenarioStep['action'];
  description: string;
  locator?: LocatorTarget;
  value?: string;
  url?: string;
  expression?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: JsonValue;
  expectStatusCode?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  assertion?: 'visible' | 'hidden' | 'enabled' | 'disabled' | 'text' | 'value' | 'url' | 'count' | 'attribute' | 'status';
  expected?: JsonValue;
  comparator?: 'equals' | 'contains' | 'matches' | 'greater-than' | 'less-than';
  attribute?: string;
  timeoutMs?: number;
  /** Marks this step as a teardown/cleanup step (required for mutating specs). */
  cleanup?: boolean;
}

export interface ControlledSpec {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  risk: ActionRisk;
  moduleIds: string[];
  routeIds: string[];
  roleIds: string[];
  tags: string[];
  createdAt: string;
  /** A skip must always carry a reason; `spec-validator` rejects reason-less skips. */
  skip?: { reason: string };
  /** Teardown steps, appended after `steps` when adapted into a TestScenario. Required when risk is mutate/destructive. */
  cleanup?: ControlledSpecStep[];
  steps: ControlledSpecStep[];
}

export interface SpecIssue {
  code:
    | 'hardcoded-secret'
    | 'unapproved-url'
    | 'dangerous-api'
    | 'risky-file-access'
    | 'absolute-xpath'
    | 'fragile-locator'
    | 'skip-without-reason'
    | 'mutate-without-cleanup'
    | 'no-assertions'
    | 'weakened-assertion'
    | 'bypassed-network-policy';
  severity: 'error' | 'warning';
  message: string;
  location?: string;
}

export interface SpecValidationContext {
  baseUrl?: string;
  allowedHosts?: string[];
  blockedHosts?: string[];
  /** Field names whose literal values count as secrets when hard-coded. */
  redactFields?: string[];
}

export interface SpecValidationResult {
  valid: boolean;
  errors: SpecIssue[];
  warnings: SpecIssue[];
}

/** A pre-compiled action produced by `action-compiler`, pairing the step with a policy pre-check. */
export interface CompiledAction {
  stepId: string;
  action: ScenarioStep['action'];
  description: string;
  risk: ActionRisk;
  cleanup: boolean;
  /** Whether the step satisfies the policy before execution (early failure instead of runtime throw). */
  policyAllowed: boolean;
  policyCode: string;
  policyReason: string;
}

export interface SpecCompilationResult {
  spec: ControlledSpec;
  scenario: import('../core/index.js').TestScenario;
  actions: CompiledAction[];
}
