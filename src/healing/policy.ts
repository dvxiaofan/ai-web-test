import type { HealingPolicyDecision, SemanticChange, SemanticChangeKind } from './types.js';

/**
 * Phase 6 healing whitelist. The verdict for a change set is the *worst*
 * verdict among its changes:
 *
 * - auto-apply    — equivalent-intent maintenance (renamed test ids, moved
 *                   paths on the same host, adjusted waits, ...);
 * - requires-approval — the test still asserts, but its meaning shifted;
 * - forbidden     — the change would let a failing test go green by weakening
 *                   what it verifies. These can never be auto-applied and are
 *                   rejected outright when proposed by automation.
 */
const AUTO_APPLY: ReadonlySet<SemanticChangeKind> = new Set([
  'locator-updated',
  'test-id-updated',
  'accessible-name-updated',
  'url-path-updated',
  'wait-adjusted',
]);

const REQUIRES_APPROVAL: ReadonlySet<SemanticChangeKind> = new Set([
  'assertion-changed',
  'step-removed',
  'step-added',
  'role-changed',
  'risk-increased',
  'host-expanded',
  'test-data-strategy-changed',
]);

const FORBIDDEN: ReadonlySet<SemanticChangeKind> = new Set([
  'assertion-removed',
  'assertion-weakened',
  'skip-added',
  'guard-disabled',
  'cleanup-removed',
]);

export function verdictForChange(kind: SemanticChangeKind): 'auto-apply' | 'requires-approval' | 'forbidden' {
  if (FORBIDDEN.has(kind)) return 'forbidden';
  if (REQUIRES_APPROVAL.has(kind)) return 'requires-approval';
  if (AUTO_APPLY.has(kind)) return 'auto-apply';
  // Unknown change kinds default to the safe side.
  return 'requires-approval';
}

/** Evaluate a change set against the whitelist; worst verdict wins. */
export function evaluateHealingChanges(changes: SemanticChange[]): HealingPolicyDecision {
  if (changes.length === 0) {
    return { verdict: 'auto-apply', blockingChanges: [], reasons: ['No semantic changes detected.'] };
  }

  const forbidden = changes.filter((change) => verdictForChange(change.kind) === 'forbidden');
  if (forbidden.length > 0) {
    return {
      verdict: 'forbidden',
      blockingChanges: forbidden,
      reasons: forbidden.map((change) => `${change.kind}: ${change.summary}`),
    };
  }

  const approval = changes.filter((change) => verdictForChange(change.kind) === 'requires-approval');
  if (approval.length > 0) {
    return {
      verdict: 'requires-approval',
      blockingChanges: approval,
      reasons: approval.map((change) => `${change.kind}: ${change.summary}`),
    };
  }

  return {
    verdict: 'auto-apply',
    blockingChanges: [],
    reasons: changes.map((change) => `${change.kind}: ${change.summary}`),
  };
}
