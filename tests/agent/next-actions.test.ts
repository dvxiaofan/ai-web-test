import { describe, it, expect } from 'vitest';
import { deriveNextActions } from '../../src/agent/next-actions.js';

describe('deriveNextActions', () => {
  it('suggests discover after init', () => {
    expect(deriveNextActions('initialized', { projectId: 'p1' })).toEqual([
      { action: 'discover', arguments: { projectId: 'p1' } },
    ]);
  });

  it('suggests plan after discover', () => {
    expect(deriveNextActions('discovered', { projectId: 'p1' })).toEqual([
      { action: 'plan', arguments: { projectId: 'p1' } },
    ]);
  });

  it('suggests approve and run after plan, carrying planId', () => {
    expect(deriveNextActions('plan_proposed', { projectId: 'p1', planId: 'plan_1' })).toEqual([
      { action: 'approve', arguments: { planId: 'plan_1' } },
      { action: 'run', arguments: { planId: 'plan_1' } },
    ]);
  });

  it('falls back to projectId when planId missing in plan_proposed', () => {
    expect(deriveNextActions('plan_proposed', { projectId: 'p1' })).toEqual([
      { action: 'approve', arguments: { projectId: 'p1' } },
      { action: 'run', arguments: { projectId: 'p1' } },
    ]);
  });

  it('suggests run after approval', () => {
    expect(deriveNextActions('plan_approved', { planId: 'plan_1' })).toEqual([
      { action: 'run', arguments: { planId: 'plan_1' } },
    ]);
  });

  it('suggests report after completion', () => {
    expect(deriveNextActions('completed', {})).toEqual([
      { action: 'report', arguments: {} },
    ]);
  });

  it('suggests re-run after failure', () => {
    expect(deriveNextActions('failed', {})).toEqual([
      { action: 'run', arguments: {} },
    ]);
  });

  it('returns empty for running and unknown states', () => {
    expect(deriveNextActions('running', {})).toEqual([]);
    expect(deriveNextActions(undefined, {})).toEqual([]);
  });
});
