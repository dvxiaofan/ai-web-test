import { describe, expect, it } from 'vitest';

import { approveProposal, createHealingProposal, rejectProposal, rollbackProposal, effectiveScenario } from '../../src/healing/proposal.js';
import type { AssertStep, ScenarioStep, TestScenario } from '../../src/core/types.js';
import type { FailureClassification } from '../../src/healing/types.js';

const navigate: ScenarioStep = { id: 's1', action: 'navigate', risk: 'read', url: 'https://app.example.com/orders' };
const assertStep: AssertStep = {
  id: 's2',
  action: 'assert',
  risk: 'read',
  assertion: 'text',
  locator: { strategy: 'testId', value: 'order-title' },
  comparator: 'equals',
  expected: 'Order #42',
};

function makeScenario(steps: ScenarioStep[], overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    schemaVersion: 1,
    id: 'scn-1',
    name: 'Demo',
    source: 'user',
    confidence: 1,
    moduleIds: [],
    routeIds: [],
    operationIds: [],
    roleIds: ['admin'],
    tags: [],
    risk: 'read',
    steps,
    evidence: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

const classification: FailureClassification = {
  scenarioId: 'scn-1',
  category: 'locator',
  confidence: 0.85,
  reasons: ['locator not found'],
  evidence: [],
};

describe('assertion guard — AI cannot go green by weakening tests', () => {
  it('rejects proposals that delete assertions, keeping the original scenario active', () => {
    const proposal = createHealingProposal({
      runId: 'run-1',
      classification,
      before: makeScenario([navigate, assertStep]),
      after: makeScenario([navigate]),
    });
    expect(proposal.status).toBe('rejected');
    expect(proposal.decision.verdict).toBe('forbidden');
    expect(effectiveScenario(proposal).steps).toHaveLength(2);
  });

  it('rejects proposals that weaken assertions or add skip', () => {
    const weakened = createHealingProposal({
      runId: 'run-1',
      classification,
      before: makeScenario([assertStep]),
      after: makeScenario([{ ...assertStep, comparator: 'contains' }]),
    });
    expect(weakened.status).toBe('rejected');

    const skipped = createHealingProposal({
      runId: 'run-1',
      classification,
      before: makeScenario([navigate, assertStep]),
      after: makeScenario([navigate, assertStep], { metadata: { skip: true } }),
    });
    expect(skipped.status).toBe('rejected');
  });

  it('rejected proposals cannot be approved afterwards', () => {
    const proposal = createHealingProposal({
      runId: 'run-1',
      classification,
      before: makeScenario([navigate, assertStep]),
      after: makeScenario([navigate]),
    });
    expect(() => approveProposal(proposal, 'alice')).toThrow(/proposed/);
  });

  it('auto-applies equivalent locator updates and keeps a rollback path', () => {
    const before = makeScenario([navigate, assertStep]);
    const after = makeScenario([navigate, { ...assertStep, locator: { strategy: 'testId', value: 'order-heading' } }]);
    const proposal = createHealingProposal({ runId: 'run-1', classification, before, after });
    expect(proposal.status).toBe('auto-applied');
    expect(effectiveScenario(proposal).steps[1]?.locator?.value).toBe('order-heading');

    const { proposal: rolledBack, restore } = rollbackProposal(proposal);
    expect(rolledBack.status).toBe('rolled-back');
    expect(restore.steps[1]?.locator?.value).toBe('order-title');
    expect(effectiveScenario(rolledBack).steps[1]?.locator?.value).toBe('order-title');
  });

  it('routes meaning-shifting changes through manual approval', () => {
    const before = makeScenario([navigate, assertStep]);
    const after = makeScenario([navigate, { ...assertStep, expected: 'Order #43' }]);
    const proposal = createHealingProposal({ runId: 'run-1', classification, before, after });
    expect(proposal.status).toBe('proposed');
    expect(effectiveScenario(proposal).steps).toEqual(before.steps);

    const approved = approveProposal(proposal, 'alice', 'business copy changed');
    expect(approved.status).toBe('approved');
    expect(approved.reviewer).toBe('alice');
    expect(effectiveScenario(approved)).toEqual(after);
  });

  it('supports explicit rejection with an audit note', () => {
    const before = makeScenario([navigate, assertStep]);
    const after = makeScenario([navigate, { ...assertStep, expected: 'Order #43' }]);
    const proposal = createHealingProposal({ runId: 'run-1', classification, before, after });
    const rejected = rejectProposal(proposal, 'bob', 'not a real product change');
    expect(rejected.status).toBe('rejected');
    expect(rejected.reviewNote).toBe('not a real product change');
  });

  it('honours requireApproval even for whitelisted changes', () => {
    const before = makeScenario([navigate, assertStep]);
    const after = makeScenario([navigate, { ...assertStep, locator: { strategy: 'testId', value: 'order-heading' } }]);
    const proposal = createHealingProposal({ runId: 'run-1', classification, before, after, requireApproval: true });
    expect(proposal.status).toBe('proposed');
  });
});
