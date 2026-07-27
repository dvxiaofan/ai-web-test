import { describe, it, expect } from 'vitest';
import {
  INITIAL_PROJECT_STATUS,
  PROJECT_STATUS_TRANSITIONS,
  canTransition,
  nextStatuses,
} from '../../src/agent/state-machine.js';
import type { AgentState } from '../../src/agent/protocol.js';

describe('agent state machine', () => {
  it('initializes at initialized', () => {
    expect(INITIAL_PROJECT_STATUS).toBe('initialized');
  });

  it('allows valid forward transitions', () => {
    expect(canTransition('initialized', 'discovered')).toBe(true);
    expect(canTransition('discovered', 'plan_proposed')).toBe(true);
    expect(canTransition('plan_proposed', 'plan_approved')).toBe(true);
    expect(canTransition('plan_approved', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
  });

  it('allows re-planning and recovery transitions', () => {
    expect(canTransition('plan_proposed', 'discovered')).toBe(true);
    expect(canTransition('failed', 'discovered')).toBe(true);
    expect(canTransition('failed', 'plan_approved')).toBe(true);
    expect(canTransition('completed', 'discovered')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('initialized', 'plan_approved')).toBe(false);
    expect(canTransition('discovered', 'running')).toBe(false);
    expect(canTransition('completed', 'plan_proposed')).toBe(false);
  });

  it('treats unknown source states as non-transitionable', () => {
    expect(canTransition('unknown' as AgentState, 'discovered')).toBe(false);
  });

  it('lists next statuses symmetrically with canTransition', () => {
    const from: AgentState = 'discovered';
    const next = nextStatuses(from);
    expect(next).toEqual(PROJECT_STATUS_TRANSITIONS[from]);
    for (const to of next) {
      expect(canTransition(from, to)).toBe(true);
    }
    expect(nextStatuses('unknown' as AgentState)).toEqual([]);
  });
});
