import { describe, expect, it } from 'vitest';
import type { TestScenario } from '../../src/core/index.js';

import {
  classifyRoleStorageState,
  minimumRisk,
  resolveRunRoles,
  selectScenariosForRole,
} from '../../src/execution/executor.js';

function scenario(id: string, roleIds: string[]): TestScenario {
  return { id, roleIds } as unknown as TestScenario;
}

describe('resolveRunRoles (role deadlock fix)', () => {
  it('always prepends anonymous when any anonymous scenario is selected', () => {
    const scenarios = [scenario('public', []), scenario('admin', ['role-admin'])];
    expect(resolveRunRoles(scenarios, ['role-admin'])).toEqual(['anonymous', 'role-admin']);
  });

  it('keeps declared roles intact when no anonymous scenario exists', () => {
    const scenarios = [scenario('admin', ['role-admin'])];
    expect(resolveRunRoles(scenarios, ['role-admin'])).toEqual(['role-admin']);
  });

  it('falls back to anonymous when no roles are declared at all', () => {
    const scenarios = [scenario('public', [])];
    expect(resolveRunRoles(scenarios, [])).toEqual(['anonymous']);
  });

  it('appends every declared role after the anonymous anchor', () => {
    const scenarios = [scenario('public', []), scenario('admin', ['role-admin']), scenario('user', ['role-user'])];
    expect(resolveRunRoles(scenarios, ['role-admin', 'role-user'])).toEqual([
      'anonymous',
      'role-admin',
      'role-user',
    ]);
  });

  it('returns no roles when selection is empty and nothing is declared', () => {
    expect(resolveRunRoles([], [])).toEqual([]);
  });
});

describe('selectScenariosForRole (role isolation)', () => {
  const scenarios = [
    scenario('public', []),
    scenario('admin', ['role-admin']),
    scenario('user', ['role-user']),
    scenario('shared', ['role-admin', 'role-user']),
  ];

  it('anonymous only runs anonymous (roleIds-empty) scenarios', () => {
    expect(selectScenariosForRole('anonymous', scenarios).map((s) => s.id)).toEqual(['public']);
  });

  it('an authenticated role never inherits anonymous scenarios (deadlock guard)', () => {
    expect(selectScenariosForRole('role-admin', scenarios).map((s) => s.id)).toEqual(['admin', 'shared']);
  });

  it('a different role only gets its own and shared scenarios', () => {
    expect(selectScenariosForRole('role-user', scenarios).map((s) => s.id)).toEqual(['user', 'shared']);
  });
});

describe('classifyRoleStorageState (authenticated run gate)', () => {
  it('anonymous always runs without storage state', () => {
    expect(classifyRoleStorageState('anonymous', undefined)).toEqual({ blocked: false, storageState: undefined });
  });

  it('an authenticated role with storage state is allowed to run', () => {
    const result = classifyRoleStorageState('role-admin', { 'role-admin': 'state-blob' });
    expect(result.blocked).toBe(false);
    expect(result.storageState).toBe('state-blob');
  });

  it('an authenticated role without storage state is blocked with an actionable error', () => {
    const result = classifyRoleStorageState('role-admin', undefined);
    expect(result.blocked).toBe(true);
    expect(result.error).toMatch(/no Playwright storage state/i);
  });
});

describe('minimumRisk (most-restrictive security ceiling)', () => {
  it('returns the most restrictive risk among the inputs', () => {
    expect(minimumRisk('destructive', 'mutate', 'read')).toBe('read');
    expect(minimumRisk('destructive', 'read')).toBe('read');
    expect(minimumRisk('mutate', 'destructive')).toBe('mutate');
  });

  it('ignores undefined entries', () => {
    expect(minimumRisk(undefined, 'mutate')).toBe('mutate');
    expect(minimumRisk('read', undefined)).toBe('read');
  });

  it('defaults to destructive when nothing is provided', () => {
    expect(minimumRisk()).toBe('destructive');
  });
});
