import { randomUUID } from 'node:crypto';

import type { TestScenario } from '../core/types.js';
import { diffScenarios } from './semantic-diff.js';
import { evaluateHealingChanges } from './policy.js';
import type { FailureClassification, HealingProposal, HealingProposalStatus } from './types.js';

export interface CreateProposalInput {
  runId: string;
  classification: FailureClassification;
  before: TestScenario;
  after: TestScenario;
  /** Force manual review even when the policy would allow auto-apply. */
  requireApproval?: boolean | undefined;
}

/**
 * Build an auditable healing proposal (Phase 6). The proposal always carries
 * the full before/after scenarios, the semantic diff and the policy verdict,
 * so it can be reviewed, applied, and rolled back deterministically.
 *
 * Forbidden change sets still produce a proposal (status `rejected`) so the
 * attempt itself is visible in the audit trail — automation must never
 * silently retry with a weaker test.
 */
export function createHealingProposal(input: CreateProposalInput): HealingProposal {
  if (input.before.id !== input.after.id) {
    throw new Error(`Healing proposal must target one scenario; got ${input.before.id} and ${input.after.id}.`);
  }
  const diff = diffScenarios(input.before, input.after);
  const decision = evaluateHealingChanges(diff.changes);

  let status: HealingProposalStatus;
  if (decision.verdict === 'forbidden') status = 'rejected';
  else if (decision.verdict === 'auto-apply' && input.requireApproval !== true && !diff.identical) status = 'auto-applied';
  else status = 'proposed';

  return {
    schemaVersion: 1,
    id: `healing-${randomUUID()}`,
    runId: input.runId,
    scenarioId: input.before.id,
    classification: input.classification,
    diff,
    decision,
    status,
    before: input.before,
    after: input.after,
    createdAt: new Date().toISOString(),
  };
}

/** Approve a pending proposal. Rejected (forbidden) proposals stay rejected. */
export function approveProposal(proposal: HealingProposal, reviewer: string, note?: string): HealingProposal {
  if (proposal.status !== 'proposed') {
    throw new Error(`Only proposals in status "proposed" can be approved (current: ${proposal.status}).`);
  }
  return {
    ...proposal,
    status: 'approved',
    reviewer,
    ...(note === undefined ? {} : { reviewNote: note }),
    updatedAt: new Date().toISOString(),
  };
}

/** Reject a pending proposal with a reason. */
export function rejectProposal(proposal: HealingProposal, reviewer: string, note: string): HealingProposal {
  if (proposal.status !== 'proposed') {
    throw new Error(`Only proposals in status "proposed" can be rejected (current: ${proposal.status}).`);
  }
  return { ...proposal, status: 'rejected', reviewer, reviewNote: note, updatedAt: new Date().toISOString() };
}

/**
 * Roll back an applied proposal — returns the original scenario to restore
 * and the updated proposal record. Works for both auto-applied and approved.
 */
export function rollbackProposal(proposal: HealingProposal): { proposal: HealingProposal; restore: TestScenario } {
  if (proposal.status !== 'auto-applied' && proposal.status !== 'approved') {
    throw new Error(`Only applied proposals can be rolled back (current: ${proposal.status}).`);
  }
  return {
    proposal: { ...proposal, status: 'rolled-back', updatedAt: new Date().toISOString() },
    restore: proposal.before,
  };
}

/** The scenario that should be active given the proposal state. */
export function effectiveScenario(proposal: HealingProposal): TestScenario {
  return proposal.status === 'auto-applied' || proposal.status === 'approved' ? proposal.after : proposal.before;
}
