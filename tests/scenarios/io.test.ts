import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ScenarioValidationError,
  loadScenarios,
  minimumRiskForStep,
  validateScenario,
} from '../../src/scenarios/io.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const baseScenario = {
  schemaVersion: 1,
  id: 'scenario-valid',
  name: 'A valid scenario',
  source: 'user',
  confidence: 1,
  moduleIds: [],
  routeIds: [],
  operationIds: [],
  roleIds: [],
  tags: ['smoke'],
  risk: 'read',
  steps: [
    {
      id: 'navigate-home',
      action: 'navigate',
      risk: 'read',
      url: '/',
    },
  ],
  evidence: [],
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;

describe('scenario runtime validation', () => {
  it('validates catalog schema and rejects duplicate scenario ids', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-web-test-scenarios-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'scenarios.json');

    await writeFile(filePath, JSON.stringify({ scenarios: [baseScenario] }));
    await expect(loadScenarios(filePath)).rejects.toThrow(/schemaVersion/);

    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, scenarios: [baseScenario, baseScenario] }));
    await expect(loadScenarios(filePath)).rejects.toThrow(/duplicate scenario id/);
  });

  it('rejects unknown actions and missing action fields', () => {
    expect(() => validateScenario({
      ...baseScenario,
      steps: [{ id: 'unknown', action: 'hover', risk: 'read' }],
    }, 'catalog.scenarios[0]')).toThrow(ScenarioValidationError);

    expect(() => validateScenario({
      ...baseScenario,
      steps: [{ id: 'click-without-locator', action: 'click', risk: 'mutate' }],
    })).toThrow(/locator/);

    expect(() => validateScenario({ ...baseScenario, risk: 'low' })).toThrow(/risk/);
    expect(() => validateScenario({
      ...baseScenario,
      steps: [{ id: 'invalid-risk', action: 'navigate', risk: 'low', url: '/' }],
    })).toThrow(/risk/);
  });

  it('enforces conservative minimum action risk and scenario risk', () => {
    expect(() => validateScenario({
      ...baseScenario,
      steps: [{
        id: 'fill-email',
        action: 'fill',
        risk: 'read',
        locator: { strategy: 'label', value: 'Email' },
        value: 'user@example.test',
      }],
    })).toThrow(/requires at least 'mutate'/);

    expect(() => validateScenario({
      ...baseScenario,
      steps: [{
        id: 'click-button',
        action: 'click',
        risk: 'read',
        locator: { strategy: 'role', value: 'button', name: 'Save' },
      }],
    })).toThrow(/requires at least 'mutate'/);

    expect(validateScenario({
      ...baseScenario,
      steps: [{
        id: 'follow-link',
        action: 'click',
        risk: 'read',
        locator: { strategy: 'url', value: '/orders' },
      }],
    }).risk).toBe('read');

    expect(() => validateScenario({
      ...baseScenario,
      risk: 'mutate',
      steps: [{ id: 'run-js', action: 'evaluate', risk: 'destructive', expression: 'void 0' }],
    })).toThrow(/below required step risk 'destructive'/);

    expect(validateScenario({
      ...baseScenario,
      risk: 'destructive',
      steps: [{ id: 'run-js', action: 'evaluate', risk: 'destructive', expression: 'void 0' }],
    }).risk).toBe('destructive');
  });

  it('requires assertion operands and validates locator strategies', () => {
    expect(() => validateScenario({
      ...baseScenario,
      steps: [{
        id: 'assert-title',
        action: 'assert',
        risk: 'read',
        assertion: 'text',
        locator: { strategy: 'not-a-locator', value: 'h1' },
        expected: 'Orders',
      }],
    })).toThrow(/strategy/);

    expect(() => validateScenario({
      ...baseScenario,
      steps: [{
        id: 'assert-title',
        action: 'assert',
        risk: 'read',
        assertion: 'text',
        locator: { strategy: 'css', value: 'h1' },
      }],
    })).toThrow(/expected/);
  });

  it('exposes the same minimum-risk policy used by validation', () => {
    expect(minimumRiskForStep({
      id: 'link',
      action: 'click',
      risk: 'read',
      locator: { strategy: 'url', value: '/orders' },
    })).toBe('read');
    expect(minimumRiskForStep({
      id: 'button',
      action: 'click',
      risk: 'mutate',
      locator: { strategy: 'role', value: 'button', name: 'Save' },
    })).toBe('mutate');
    expect(minimumRiskForStep({
      id: 'script',
      action: 'evaluate',
      risk: 'destructive',
      expression: 'void 0',
    })).toBe('destructive');
  });
});
