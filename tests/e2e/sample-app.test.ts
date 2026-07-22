import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { exploreBrowser } from '../../src/browser/index.js';
import { createDefaultPolicy } from '../../src/core/index.js';
import { discoverSource } from '../../src/discovery/index.js';
import { mergeBrowserExploration } from '../../src/inventory/index.js';
import { approvePlan, proposePlan } from '../../src/planning/index.js';
import { executePlan } from '../../src/execution/index.js';
import { generateRouteSmokeScenarios } from '../../src/scenarios/index.js';

const runE2E = process.env.AI_WEB_TEST_E2E === '1';

describe.skipIf(!runE2E)('sample app end-to-end workflow', () => {
  let child: ChildProcess | undefined;
  const port = 4197;
  const baseUrl = `http://127.0.0.1:${port}`;

  it('discovers, plans, approves, and executes read-only browser scenarios', async () => {
    const fixtureRoot = path.resolve('fixtures/sample-app');
    child = spawn('node', ['server.mjs'], { cwd: fixtureRoot, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    await waitForUrl(baseUrl);

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

    const inventory = mergeBrowserExploration(draft.inventory, exploration);
    const scenarios = generateRouteSmokeScenarios(inventory, { screenshot: false });
    const policy = createDefaultPolicy(baseUrl);
    const proposed = proposePlan({
      inventory,
      scenarios,
      scope: { mode: 'smoke', includeDependencies: true },
      target: { baseUrl, projectRoot: fixtureRoot, environment: 'test' },
      policy,
      roles: [],
      browserProfiles: [{ id: 'chromium', browser: 'chromium', headless: true, viewport: { width: 1280, height: 800 } }],
      level: 'smoke',
    });
    expect(proposed.validation.valid).toBe(true);
    const approved = approvePlan(proposed.plan, { approvedBy: 'e2e' }, { inventory, scenarios });
    const result = await executePlan(approved, {
      inventory,
      scenarios,
      outputDir: path.resolve('.tmp-e2e-runs'),
      captureTrace: false,
      captureScreenshotsOnFailure: false,
      playwrightLoader: async () => import('playwright'),
    });
    expect(result.status).toBe('passed');
    expect(result.coverage.scenarios.passed).toBeGreaterThan(0);
  }, 120_000);

  it('stops the fixture process', async () => {
    child?.kill('SIGTERM');
    child = undefined;
  });
});

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
