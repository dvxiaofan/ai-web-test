import type {
  EvidenceRef,
  IsoDateTime,
  JsonObject,
  ScenarioResult,
  TestScenario,
} from '../core/types.js';

/**
 * Phase 6 — deterministic failure classification. Unlike `ai/triage.ts`
 * (which asks an AI provider for a judgement), these categories are derived
 * from run evidence with fixed rules so they are reproducible and auditable.
 */
export type FailureCategory =
  | 'environment'
  | 'authentication'
  | 'navigation'
  | 'locator'
  | 'assertion'
  | 'api'
  | 'permission'
  | 'test-data'
  | 'cleanup'
  | 'browser-infrastructure';

export interface FailureClassification {
  scenarioId: string;
  /** Step where the failure surfaced, when identifiable. */
  stepId?: string | undefined;
  category: FailureCategory;
  /** 0..1 — how strongly the evidence supports the category. */
  confidence: number;
  /** Human-readable reasons referencing the evidence used. */
  reasons: string[];
  evidence: EvidenceRef[];
}

/**
 * Semantic diff between an existing scenario and a proposed replacement.
 * Change kinds map directly onto the healing policy whitelist.
 */
export type SemanticChangeKind =
  // Auto-applicable (equivalent-intent) changes.
  | 'locator-updated'
  | 'test-id-updated'
  | 'accessible-name-updated'
  | 'url-path-updated'
  | 'wait-adjusted'
  // Changes that require re-approval.
  | 'assertion-changed'
  | 'step-removed'
  | 'step-added'
  | 'role-changed'
  | 'risk-increased'
  | 'host-expanded'
  | 'test-data-strategy-changed'
  // Never auto-applicable.
  | 'assertion-removed'
  | 'assertion-weakened'
  | 'skip-added'
  | 'guard-disabled'
  | 'cleanup-removed';

export interface SemanticChange {
  kind: SemanticChangeKind;
  /** Step id in the original scenario (if the change is step-scoped). */
  stepId?: string | undefined;
  summary: string;
  before?: string | undefined;
  after?: string | undefined;
}

export interface SemanticDiff {
  scenarioId: string;
  changes: SemanticChange[];
  /** True when the two scenarios are semantically identical. */
  identical: boolean;
}

/** Policy verdict for a proposed healing change set. */
export type HealingVerdict = 'auto-apply' | 'requires-approval' | 'forbidden';

export interface HealingPolicyDecision {
  verdict: HealingVerdict;
  /** Changes that made the verdict what it is (worst offenders first). */
  blockingChanges: SemanticChange[];
  reasons: string[];
}

export type HealingProposalStatus =
  | 'proposed'
  | 'auto-applied'
  | 'approved'
  | 'rejected'
  | 'rolled-back';

/**
 * A healing proposal binds together: the failure that motivated it, the
 * semantic diff of the fix, the policy verdict, and enough state to audit
 * and roll the change back (the full before/after scenarios).
 */
export interface HealingProposal {
  schemaVersion: 1;
  id: string;
  runId: string;
  scenarioId: string;
  classification: FailureClassification;
  diff: SemanticDiff;
  decision: HealingPolicyDecision;
  status: HealingProposalStatus;
  /** Full original scenario — the rollback target. */
  before: TestScenario;
  /** Full proposed scenario. */
  after: TestScenario;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime | undefined;
  reviewer?: string | undefined;
  reviewNote?: string | undefined;
  metadata?: JsonObject | undefined;
}

/** Input bundle for the deterministic classifier. */
export interface ClassifierInput {
  scenario: ScenarioResult;
  /** Optional: role expected by the plan, for permission mismatch checks. */
  expectedRole?: string | undefined;
}
