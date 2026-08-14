import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { exploreBrowser } from '../../src/browser/index.js';
import { createDefaultPolicy } from '../../src/core/index.js';
import type { BrowserProfile } from '../../src/core/types.js';
import { discoverSource } from '../../src/discovery/index.js';
import { mergeBrowserExploration } from '../../src/inventory/index.js';
import { approvePlan, proposePlan } from '../../src/planning/index.js';
import { executePlan } from '../../src/execution/index.js';
import { generateRouteSmokeScenarios } from '../../src/scenarios/index.js';
import type { Inventory, TestScenario } from '../../src/core/index.js';

const runE2E = process.env.AI_WEB_TEST_E2E === '1';

describe.skipIf(!runE2E)('sample app end-to-end workflow', () => {
  let child: ChildProcess | undefined;
  const port = 4197;
  const baseUrl = `http://127.0.0.1:${port}`;
  const fixtureRoot = path.resolve('fixtures/sample-app');
  const outputDir = path.resolve('.tmp-e2e-runs');

  async function buildInventory(): Promise<Inventory> {
    const draft = await discoverSource({ rootDir: fixtureRoot, baseUrl, projectName: 'sample-shop' });
    expect(draft.routes.length).toBeGreaterThanOrEqual(4);
    expect(draft.apiOperations.length).toBeGreaterThanOrEqual(2);

    const exploration = await exploreBrowser({
      baseUrl,
      browserName: 'chromium',
      headless: true,
      maxPages: 10,
      captureScreenshots: false,
      playwrightLoader: async () => import('playwright'),
    });
    expect(exploration.status).toBe('completed');
    expect(exploration.pages.length).toBeGreaterThan(0);

    return mergeBrowserExploration(draft.inventory, exploration);
  }

  function makeBrowserProfile(): BrowserProfile[] {
    return [{ id: 'chromium', browser: 'chromium', headless: true, viewport: { width: 1280, height: 800 } }];
  }

  beforeAll(async () => {
    child = spawn('node', ['server.mjs'], { cwd: fixtureRoot, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    await waitForUrl(baseUrl);
  }, 30_000);

  afterAll(() => {
    child?.kill('SIGTERM');
    child = undefined;
  });

  it('runs anonymous smoke scenarios to completion when no roles are involved', async () => {
    const inventory = await buildInventory();
    const scenarios = generateRouteSmokeScenarios(inventory, { screenshot: false });
    const anonymousScenarios = scenarios.filter((scenario) => scenario.roleIds.length === 0);
    expect(anonymousScenarios.length).toBeGreaterThan(0);

    const policy = createDefaultPolicy(baseUrl);
    const proposed = proposePlan({
      inventory,
      scenarios: anonymousScenarios,
      scope: { mode: 'smoke', includeDependencies: true },
      target: { baseUrl, projectRoot: fixtureRoot, environment: 'test' },
      policy,
      roles: [],
      browserProfiles: makeBrowserProfile(),
      level: 'smoke',
    });
    expect(proposed.validation.valid, formatIssues(proposed.validation.issues)).toBe(true);

    const approved = approvePlan(proposed.plan, { approvedBy: 'e2e' }, { inventory, scenarios: anonymousScenarios });
    const result = await executePlan(approved, {
      inventory,
      scenarios: anonymousScenarios,
      outputDir,
      captureTrace: false,
      captureScreenshotsOnFailure: false,
      playwrightLoader: async () => import('playwright'),
    });

    expect(result.status).toBe('passed');
    expect(result.coverage.scenarios.blocked).toBe(0);
    expect(result.coverage.scenarios.passed).toBeGreaterThan(0);
  }, 120_000);

  it('blocks authenticated scenarios missing storage state without blocking anonymous scenarios', async () => {
    const inventory = await buildInventory();
    const scenarios = generateRouteSmokeScenarios(inventory, { screenshot: false });
    const roleScenarios = scenarios.filter((scenario) => scenario.roleIds.length > 0);
    expect(roleScenarios.length).toBeGreaterThan(0);
    const requiredRoleIds = [...new Set(roleScenarios.flatMap((scenario) => scenario.roleIds))];
    expect(requiredRoleIds.length).toBeGreaterThan(0);

    const policy = createDefaultPolicy(baseUrl);
    const proposed = proposePlan({
      inventory,
      scenarios,
      scope: { mode: 'smoke', includeDependencies: true },
      target: { baseUrl, projectRoot: fixtureRoot, environment: 'test' },
      policy,
      roles: requiredRoleIds,
      browserProfiles: makeBrowserProfile(),
      level: 'smoke',
    });
    expect(proposed.validation.valid, formatIssues(proposed.validation.issues)).toBe(true);

    const approved = approvePlan(proposed.plan, { approvedBy: 'e2e' }, { inventory, scenarios });
    // Deliberately omit storageStateByRole so authenticated scenarios cannot run.
    const result = await executePlan(approved, {
      inventory,
      scenarios,
      outputDir,
      captureTrace: false,
      captureScreenshotsOnFailure: false,
      playwrightLoader: async () => import('playwright'),
    });

    const anonymousResults = result.scenarios.filter((scenario) => scenario.role === 'anonymous');
    const adminResults = result.scenarios.filter((scenario) => requiredRoleIds.includes(scenario.role));

    expect(anonymousResults.length).toBeGreaterThan(0);
    expect(anonymousResults.every((scenario) => scenario.status === 'passed')).toBe(true);

    expect(adminResults.length).toBeGreaterThan(0);
    expect(adminResults.every((scenario) => scenario.status === 'blocked')).toBe(true);
    expect(adminResults.every((scenario) => /storage state/i.test(scenario.error?.message ?? ''))).toBe(true);
  }, 120_000);
});

function formatIssues(issues: ReadonlyArray<{ severity: string; message: string }>): string {
  if (issues.length === 0) return 'no issues';
  return issues.map((issue) => `[${issue.severity}] ${issue.message}`).join('\n');
}

async function waitForUrl(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // target is still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Fixture did not start at ${url}`);
}
