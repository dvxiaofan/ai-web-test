import { describe, expect, it } from 'vitest';

import { evaluateHealingChanges, verdictForChange } from '../../src/healing/policy.js';
import type { SemanticChange } from '../../src/healing/types.js';

function change(kind: SemanticChange['kind']): SemanticChange {
  return { kind, summary: `${kind} test change` };
}

describe('verdictForChange', () => {
  it('whitelists equivalent-intent maintenance', () => {
    for (const kind of ['locator-updated', 'test-id-updated', 'accessible-name-updated', 'url-path-updated', 'wait-adjusted'] as const) {
      expect(verdictForChange(kind)).toBe('auto-apply');
    }
  });

  it('requires approval for meaning-shifting changes', () => {
    for (const kind of ['assertion-changed', 'step-removed', 'step-added', 'role-changed', 'risk-increased', 'host-expanded', 'test-data-strategy-changed'] as const) {
      expect(verdictForChange(kind)).toBe('requires-approval');
    }
  });

  it('forbids weakening changes', () => {
    for (const kind of ['assertion-removed', 'assertion-weakened', 'skip-added', 'guard-disabled', 'cleanup-removed'] as const) {
      expect(verdictForChange(kind)).toBe('forbidden');
    }
  });
});

describe('evaluateHealingChanges', () => {
  it('auto-applies when all changes are whitelisted', () => {
    const decision = evaluateHealingChanges([change('test-id-updated'), change('wait-adjusted')]);
    expect(decision.verdict).toBe('auto-apply');
    expect(decision.blockingChanges).toHaveLength(0);
  });

  it('the worst verdict wins: one forbidden change forbids the whole set', () => {
    const decision = evaluateHealingChanges([change('test-id-updated'), change('assertion-removed')]);
    expect(decision.verdict).toBe('forbidden');
    expect(decision.blockingChanges.map((c) => c.kind)).toEqual(['assertion-removed']);
  });

  it('requires approval when the set contains approval-level changes but nothing forbidden', () => {
    const decision = evaluateHealingChanges([change('locator-updated'), change('host-expanded')]);
    expect(decision.verdict).toBe('requires-approval');
    expect(decision.blockingChanges.map((c) => c.kind)).toEqual(['host-expanded']);
  });

  it('treats an empty change set as auto-apply (no-op)', () => {
    expect(evaluateHealingChanges([]).verdict).toBe('auto-apply');
  });
});
