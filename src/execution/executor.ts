import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Locator, Page, Response } from 'playwright';

import {
  assertActionAllowed,
  contentDigest,
  stableId,
  type ArtifactRef,
  type AssertionResult,
  type BrowserProfile,
  type Inventory,
  type JsonValue,
  type LocatorTarget,
  type RunCoverage,
  type RunPlan,
  type RunResult,
  type ScenarioResult,
  type ScenarioStep,
  type StepResult,
  type TestScenario,
} from '../core/index.js';
import { compareOrCreateVisualSnapshot } from './visual.js';

export interface ExecutePlanOptions {
  scenarios: TestScenario[];
  inventory?: Inventory;
  outputDir: string;
  storageStateByRole?: Record<string, string>;
  environmentVariables?: Record<string, string | undefined>;
  captureTrace?: boolean;
  captureScreenshotsOnFailure?: boolean;
  visualBaselineDir?: string;
  updateVisualBaselines?: boolean;
  failOnVisualDiff?: boolean;
  ignoreHTTPSErrors?: boolean;
  defaultActionTimeoutMs?: number;
  playwrightLoader?: () => Promise<typeof import('playwright')>;
  onProgress?: (event: ExecutionProgressEvent) => void;
}

export type ExecutionProgressEvent =
  | { type: 'run-started'; runId: string }
  | { type: 'scenario-started'; scenarioId: string; role: string; profileId: string }
  | { type: 'step-finished'; scenarioId: string; stepId: string; status: StepResult['status'] }
  | { type: 'scenario-finished'; scenarioId: string; status: ScenarioResult['status'] }
  | { type: 'run-finished'; runId: string; status: RunResult['status'] };

interface ScenarioExecutionContext {
  page: Page;
  scenario: TestScenario;
  plan: RunPlan;
  role: string;
  profile: BrowserProfile;
  outputDir: string;
  environmentVariables: Record<string, string | undefined>;
  responses: Response[];
  visualBaselineDir?: string;
  updateVisualBaselines: boolean;
  failOnVisualDiff: boolean;
  defaultActionTimeoutMs: number;
}

export async function executePlan(plan: RunPlan, options: ExecutePlanOptions): Promise<RunResult> {
  assertApprovedPlan(plan);
  const startedAt = new Date();
  const runId = stableId('run', `${plan.id}:${startedAt.toISOString()}`);
  const runDir = path.resolve(options.outputDir, runId);
  await mkdir(runDir, { recursive: true });
  options.onProgress?.({ type: 'run-started', runId });

  const selectedScenarios = selectPlanScenarios(plan, options.scenarios);
  const profiles = plan.browserProfiles;
  const roles = plan.roles.length > 0 ? plan.roles : ['anonymous'];
  const scenarioResults: ScenarioResult[] = [];
  let infrastructureError: Error | undefined;
  let playwright: typeof import('playwright');

  try {
    playwright = await (options.playwrightLoader ?? (() => import('playwright')))();
  } catch (error) {
    infrastructureError = asError(error);
    playwright = undefined as never;
  }

  if (!infrastructureError) {
    for (const profile of profiles) {
      const browserType = playwright[profile.browser];
      let browser: Browser | undefined;
      try {
        browser = await browserType.launch({ headless: profile.headless });
        for (const role of roles) {
          const roleScenarios = selectedScenarios.filter(
            (scenario) => scenario.roleIds.length === 0 || scenario.roleIds.includes(role),
          );
          for (const scenario of roleScenarios) {
            options.onProgress?.({ type: 'scenario-started', scenarioId: scenario.id, role, profileId: profile.id });
            const result = await executeScenario(browser, plan, scenario, role, profile, runDir, options);
            scenarioResults.push(result);
            options.onProgress?.({ type: 'scenario-finished', scenarioId: scenario.id, status: result.status });
          }
        }
      } catch (error) {
        infrastructureError = asError(error);
      } finally {
        await browser?.close().catch(() => undefined);
      }
      if (infrastructureError) break;
    }
  }

  if (infrastructureError) {
    for (const scenario of selectedScenarios) {
      if (scenarioResults.some((result) => result.scenarioId === scenario.id)) continue;
      scenarioResults.push(blockedScenarioResult(scenario, profiles[0]?.id ?? 'unavailable', roles[0] ?? 'anonymous', infrastructureError));
    }
  }

  const endedAt = new Date();
  const coverage = buildRunCoverage(plan, selectedScenarios, scenarioResults, options.inventory);
  const status = deriveRunStatus(scenarioResults, infrastructureError);
  const result: RunResult = {
    schemaVersion: 1,
    id: runId,
    planId: plan.id,
    planDigest: plan.digest,
    inventoryId: plan.inventoryId,
    inventoryDigest: plan.inventoryDigest,
    status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    scenarios: scenarioResults,
    findings: [],
    coverage,
    artifacts: [],
    environment: {
      baseUrl: plan.target.baseUrl,
      browserProfiles: profiles.map((profile) => profile.id),
      platform: process.platform,
    },
    ...(infrastructureError
      ? { metadata: { infrastructureError: infrastructureError.message } }
      : {}),
  };
  options.onProgress?.({ type: 'run-finished', runId, status });
  return result;
}

async function executeScenario(
  browser: Browser,
  plan: RunPlan,
  scenario: TestScenario,
  role: string,
  profile: BrowserProfile,
  runDir: string,
  options: ExecutePlanOptions,
): Promise<ScenarioResult> {
  const startedAt = new Date();
  const scenarioDir = path.join(runDir, sanitizeFilename(`${scenario.id}-${role}-${profile.id}`));
  await mkdir(scenarioDir, { recursive: true });
  const storageState = role === 'anonymous' ? undefined : options.storageStateByRole?.[role];
  const context = await createContext(browser, profile, storageState, options.ignoreHTTPSErrors ?? false);
  const tracePath = path.join(scenarioDir, 'trace.zip');
  if (options.captureTrace !== false) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const responses: Response[] = [];
  page.on('response', (response) => responses.push(response));

  const stepResults: StepResult[] = [];
  let scenarioError: Error | undefined;
  try {
    for (const step of scenario.steps) {
      const stepResult = await executeStep({
        page,
        scenario,
        plan,
        role,
        profile,
        outputDir: scenarioDir,
        environmentVariables: { ...process.env, ...options.environmentVariables },
        responses,
        ...(options.visualBaselineDir ? { visualBaselineDir: options.visualBaselineDir } : {}),
        updateVisualBaselines: options.updateVisualBaselines ?? false,
        failOnVisualDiff: options.failOnVisualDiff ?? true,
        defaultActionTimeoutMs: options.defaultActionTimeoutMs ?? 10_000,
      }, step);
      stepResults.push(stepResult);
      options.onProgress?.({ type: 'step-finished', scenarioId: scenario.id, stepId: step.id, status: stepResult.status });
      if (stepResult.status === 'failed' || stepResult.status === 'error' || stepResult.status === 'blocked') {
        scenarioError = stepResult.error ? new Error(stepResult.error.message) : new Error(`Step ${step.id} failed.`);
        break;
      }
    }
  } catch (error) {
    scenarioError = asError(error);
  }

  const artifacts: ArtifactRef[] = [];
  if (scenarioError && options.captureScreenshotsOnFailure !== false) {
    const screenshotPath = path.join(scenarioDir, 'failure.png');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    artifacts.push({ path: screenshotPath, kind: 'screenshot', mimeType: 'image/png' });
  }
  if (options.captureTrace !== false) {
    await context.tracing.stop({ path: tracePath }).catch(() => undefined);
    artifacts.push({ path: tracePath, kind: 'trace', mimeType: 'application/zip' });
  }
  await context.close();

  const endedAt = new Date();
  const blocked = stepResults.some((step) => step.status === 'blocked');
  const status: ScenarioResult['status'] = blocked ? 'blocked' : scenarioError ? 'failed' : 'passed';
  const observedApis = responses
    .filter((response) => ['xhr', 'fetch'].includes(response.request().resourceType()))
    .map((response) => ({ method: response.request().method(), url: response.url(), status: response.status() }));
  return {
    scenarioId: scenario.id,
    role,
    browserProfileId: profile.id,
    status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    steps: stepResults,
    findingIds: [],
    artifacts,
    ...(scenarioError ? { error: serializeError(scenarioError) } : {}),
    metadata: { observedApis },
  };
}

async function executeStep(context: ScenarioExecutionContext, step: ScenarioStep): Promise<StepResult> {
  const startedAt = new Date();
  const artifacts: ArtifactRef[] = [];
  const assertions: AssertionResult[] = [];
  try {
    assertActionAllowed(
      context.plan.policy,
      { name: step.name?.trim() || step.id, risk: step.risk, ...(step.action === 'navigate' ? { url: step.url } : {}) },
      context.plan.target.baseUrl,
    );
    context.page.setDefaultTimeout(step.timeoutMs ?? context.defaultActionTimeoutMs);

    switch (step.action) {
      case 'navigate': {
        const url = new URL(step.url, context.plan.target.baseUrl).href;
        await context.page.goto(url, { waitUntil: step.waitUntil ?? 'domcontentloaded' });
        break;
      }
      case 'click':
        await resolveLocator(context.page, step.locator).click({
          ...(step.button === undefined ? {} : { button: step.button }),
          ...(step.clickCount === undefined ? {} : { clickCount: step.clickCount }),
        });
        break;
      case 'fill':
        await resolveLocator(context.page, step.locator).fill(resolveValue(step.value, context.environmentVariables));
        break;
      case 'select-option':
        await resolveLocator(context.page, step.locator).selectOption(step.value);
        break;
      case 'check':
        await resolveLocator(context.page, step.locator).check();
        break;
      case 'uncheck':
        await resolveLocator(context.page, step.locator).uncheck();
        break;
      case 'press':
        await resolveLocator(context.page, step.locator).press(step.key);
        break;
      case 'wait':
        await executeWait(context.page, step);
        break;
      case 'assert':
        assertions.push(await executeAssertion(context, step));
        if (assertions[0]?.status === 'failed') throw new Error(assertions[0].message);
        break;
      case 'screenshot': {
        const screenshotPath = path.join(context.outputDir, `${sanitizeFilename(step.name ?? step.id)}.png`);
        await context.page.screenshot({ path: screenshotPath, fullPage: step.fullPage ?? true });
        artifacts.push({ path: screenshotPath, kind: 'screenshot', mimeType: 'image/png' });
        const visual = await compareOrCreateVisualSnapshot(screenshotPath, {
          ...(context.visualBaselineDir ? { baselineDir: context.visualBaselineDir } : {}),
          ...(step.baselineKey ? { baselineKey: step.baselineKey } : {}),
          updateBaseline: context.updateVisualBaselines,
        });
        if (visual.baselinePath) {
          artifacts.push({ path: visual.baselinePath, kind: 'other', mimeType: 'image/png' });
        }
        if (visual.changed && context.failOnVisualDiff && !context.updateVisualBaselines) {
          throw new Error(`Visual snapshot changed for ${step.baselineKey ?? step.id}. Current digest ${visual.currentDigest}; baseline digest ${visual.baselineDigest ?? 'missing'}.`);
        }
        break;
      }
      case 'evaluate':
        await context.page.evaluate(step.expression);
        break;
    }

    const endedAt = new Date();
    return {
      stepId: step.id,
      action: step.action,
      status: 'passed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      assertions,
      artifacts,
    };
  } catch (error) {
    const endedAt = new Date();
    const serialized = serializeError(asError(error));
    const blocked = serialized.name === 'PolicyViolationError';
    return {
      stepId: step.id,
      action: step.action,
      status: blocked ? 'blocked' : 'failed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      error: serialized,
      assertions,
      artifacts,
    };
  }
}

async function executeAssertion(
  context: ScenarioExecutionContext,
  step: Extract<ScenarioStep, { action: 'assert' }>,
): Promise<AssertionResult> {
  const started = Date.now();
  const locator = step.locator ? resolveLocator(context.page, step.locator) : undefined;
  let actual: JsonValue = null;
  let passed = false;

  switch (step.assertion) {
    case 'visible':
      actual = (await requireLocator(locator, step).isVisible()) as JsonValue;
      passed = actual === true;
      break;
    case 'hidden':
      actual = (await requireLocator(locator, step).isHidden()) as JsonValue;
      passed = actual === true;
      break;
    case 'enabled':
      actual = (await requireLocator(locator, step).isEnabled()) as JsonValue;
      passed = actual === true;
      break;
    case 'disabled':
      actual = (await requireLocator(locator, step).isDisabled()) as JsonValue;
      passed = actual === true;
      break;
    case 'text':
      actual = (await requireLocator(locator, step).textContent()) ?? '';
      passed = compareValues(actual, step.expected, step.comparator ?? 'contains');
      break;
    case 'value':
      actual = await requireLocator(locator, step).inputValue();
      passed = compareValues(actual, step.expected, step.comparator ?? 'equals');
      break;
    case 'url':
      actual = context.page.url();
      passed = compareValues(actual, step.expected, step.comparator ?? 'contains');
      break;
    case 'count':
      actual = await requireLocator(locator, step).count();
      passed = compareValues(actual, step.expected, step.comparator ?? 'equals');
      break;
    case 'attribute':
      if (!step.attribute) throw new Error('Attribute assertion requires the attribute field.');
      actual = (await requireLocator(locator, step).getAttribute(step.attribute)) ?? '';
      passed = compareValues(actual, step.expected, step.comparator ?? 'equals');
      break;
    case 'status': {
      const latest = context.responses.at(-1);
      actual = latest?.status() ?? null;
      passed = compareValues(actual, step.expected, step.comparator ?? 'equals');
      break;
    }
  }

  return {
    id: stableId('assertion', `${context.scenario.id}:${step.id}`),
    status: passed ? 'passed' : 'failed',
    message: passed
      ? `${step.assertion} assertion passed.`
      : `${step.assertion} assertion failed: expected ${JSON.stringify(step.expected)}, received ${JSON.stringify(actual)}.`,
    ...(step.expected !== undefined ? { expected: step.expected } : {}),
    actual,
    durationMs: Date.now() - started,
  };
}

function resolveLocator(page: Page, target: LocatorTarget): Locator {
  let locator: Locator;
  switch (target.strategy) {
    case 'role':
      locator = page.getByRole(target.value as Parameters<Page['getByRole']>[0], {
        ...(target.name ? { name: target.name } : {}),
        ...(target.exact !== undefined ? { exact: target.exact } : {}),
      });
      break;
    case 'label':
      locator = page.getByLabel(target.value, target.exact === undefined ? {} : { exact: target.exact });
      break;
    case 'text':
      locator = page.getByText(target.value, target.exact === undefined ? {} : { exact: target.exact });
      break;
    case 'testId':
      locator = page.getByTestId(target.value);
      break;
    case 'placeholder':
      locator = page.getByPlaceholder(target.value, target.exact === undefined ? {} : { exact: target.exact });
      break;
    case 'xpath':
      locator = page.locator(`xpath=${target.value}`);
      break;
    case 'url':
      locator = page.locator(`a[href="${cssEscape(target.value)}"]`);
      break;
    case 'relative':
    case 'css':
      locator = page.locator(target.value);
      break;
  }
  return target.nth === undefined ? locator : locator.nth(target.nth);
}

async function executeWait(page: Page, step: Extract<ScenarioStep, { action: 'wait' }>): Promise<void> {
  if (step.durationMs !== undefined) {
    await page.waitForTimeout(step.durationMs);
    return;
  }
  if (step.for === 'network-idle') {
    await page.waitForLoadState('networkidle');
  } else if (step.for === 'load-state') {
    await page.waitForLoadState('domcontentloaded');
  } else if (step.for === 'selector' && step.locator) {
    await resolveLocator(page, step.locator).waitFor();
  } else {
    await page.waitForTimeout(250);
  }
}

async function createContext(browser: Browser, profile: BrowserProfile, storageState: string | undefined, ignoreHTTPSErrors: boolean): Promise<BrowserContext> {
  return browser.newContext({
    viewport: profile.viewport,
    ignoreHTTPSErrors,
    ...(storageState ? { storageState } : {}),
    ...(profile.deviceScaleFactor !== undefined ? { deviceScaleFactor: profile.deviceScaleFactor } : {}),
    ...(profile.isMobile !== undefined ? { isMobile: profile.isMobile } : {}),
    ...(profile.hasTouch !== undefined ? { hasTouch: profile.hasTouch } : {}),
    ...(profile.locale ? { locale: profile.locale } : {}),
    ...(profile.colorScheme ? { colorScheme: profile.colorScheme } : {}),
    ...(profile.timezoneId ? { timezoneId: profile.timezoneId } : {}),
    ...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
  });
}

function compareValues(
  actual: JsonValue,
  expected: JsonValue | undefined,
  comparator: NonNullable<Extract<ScenarioStep, { action: 'assert' }>['comparator']>,
): boolean {
  switch (comparator) {
    case 'equals':
      return JSON.stringify(actual) === JSON.stringify(expected);
    case 'contains':
      return String(actual).includes(String(expected ?? ''));
    case 'matches':
      return new RegExp(String(expected ?? '')).test(String(actual));
    case 'greater-than':
      return Number(actual) > Number(expected);
    case 'less-than':
      return Number(actual) < Number(expected);
  }
}

function resolveValue(value: string, environment: Record<string, string | undefined>): string {
  const match = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/) ?? value.match(/^env:([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (!match) return value;
  const name = match[1];
  const resolved = name ? environment[name] : undefined;
  if (resolved === undefined) throw new Error(`Required environment variable ${name ?? '(unknown)'} is missing.`);
  return resolved;
}

function requireLocator(locator: Locator | undefined, step: ScenarioStep): Locator {
  if (!locator) throw new Error(`Assertion ${step.id} requires a locator.`);
  return locator;
}

function selectPlanScenarios(plan: RunPlan, scenarios: TestScenario[]): TestScenario[] {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const selectedIds = [...plan.scenarioIds, ...plan.autoIncludedScenarioIds];
  const missing = selectedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`Approved plan references missing scenarios: ${missing.join(', ')}`);
  return [...new Set(selectedIds)].map((id) => byId.get(id)).filter((scenario): scenario is TestScenario => Boolean(scenario));
}

function assertApprovedPlan(plan: RunPlan): void {
  if (plan.status !== 'approved' || !plan.approval) {
    throw new Error(`Run plan ${plan.id} is not approved. Refusing to execute browser actions.`);
  }
  if (plan.approval.inventoryDigest !== plan.inventoryDigest) {
    throw new Error('Run plan approval does not match its inventory digest. Re-plan and approve again.');
  }
  if (plan.approval.policyDigest !== contentDigest(plan.policy)) {
    throw new Error('Run plan policy changed after approval. Re-plan and approve again.');
  }
}

function blockedScenarioResult(scenario: TestScenario, profileId: string, role: string, error: Error): ScenarioResult {
  const now = new Date().toISOString();
  return {
    scenarioId: scenario.id,
    role,
    browserProfileId: profileId,
    status: 'blocked',
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    steps: [],
    findingIds: [],
    artifacts: [],
    error: serializeError(error),
  };
}

function buildRunCoverage(
  plan: RunPlan,
  scenarios: TestScenario[],
  results: ScenarioResult[],
  inventory?: Inventory,
): RunCoverage {
  const routeIds = new Set(scenarios.flatMap((scenario) => scenario.routeIds));
  const apiIds = new Set(scenarios.flatMap((scenario) => scenario.operationIds));
  const executedIds = new Set(results.map((result) => result.scenarioId));
  const passedIds = new Set(results.filter((result) => result.status === 'passed').map((result) => result.scenarioId));
  const failedIds = new Set(results.filter((result) => result.status === 'failed').map((result) => result.scenarioId));
  const blockedIds = new Set(results.filter((result) => result.status === 'blocked').map((result) => result.scenarioId));
  const passedRouteIds = new Set(scenarios.filter((scenario) => passedIds.has(scenario.id)).flatMap((scenario) => scenario.routeIds));
  const failedRouteIds = new Set(scenarios.filter((scenario) => failedIds.has(scenario.id)).flatMap((scenario) => scenario.routeIds));
  const knownRouteIds = new Set(inventory?.nodes.filter((node) => node.kind === 'route').map((node) => node.id) ?? []);
  const unresolvedIds = [...routeIds].filter((id) => knownRouteIds.size > 0 && !knownRouteIds.has(id));
  const observedApiIds = matchObservedApiIds(results, inventory);
  const assertedApiIds = new Set(scenarios.filter((scenario) => scenario.steps.some((step) => step.action === 'assert' && step.assertion === 'status')).flatMap((scenario) => scenario.operationIds));
  return {
    routes: { selected: routeIds.size, visited: routeIds.size - unresolvedIds.length, passed: passedRouteIds.size },
    pages: { selected: routeIds.size, rendered: routeIds.size - unresolvedIds.length, failed: failedRouteIds.size },
    apis: { selected: apiIds.size, observed: observedApiIds.size, asserted: assertedApiIds.size },
    scenarios: {
      selected: scenarios.length,
      executed: executedIds.size,
      passed: passedIds.size,
      failed: failedIds.size,
      blocked: blockedIds.size,
    },
    roles: { selected: plan.roles.length || 1, exercised: new Set(results.map((result) => result.role)).size },
    browsers: { selected: plan.browserProfiles.length, exercised: new Set(results.map((result) => result.browserProfileId)).size },
    unresolvedIds,
  };
}

function matchObservedApiIds(results: ScenarioResult[], inventory?: Inventory): Set<string> {
  const matched = new Set<string>();
  if (!inventory) return matched;
  const apis = inventory.nodes.filter((node) => node.kind === 'api');
  for (const result of results) {
    const observations = result.metadata?.observedApis;
    if (!Array.isArray(observations)) continue;
    for (const observation of observations) {
      if (typeof observation !== 'object' || observation === null || Array.isArray(observation)) continue;
      const method = typeof observation.method === 'string' ? observation.method.toUpperCase() : '';
      const rawUrl = typeof observation.url === 'string' ? observation.url : '';
      let pathname = rawUrl;
      try { pathname = new URL(rawUrl).pathname; } catch { /* keep raw pattern */ }
      for (const api of apis) {
        if (api.method.toUpperCase() === method && apiPathMatches(api.urlPattern, pathname)) matched.add(api.id);
      }
    }
  }
  return matched;
}

function apiPathMatches(pattern: string, pathname: string): boolean {
  const tokenized = (pattern.split('?')[0] ?? pattern)
    .replace(/\$\{[^}]+\}/g, '__AIWEBTEST_DYNAMIC__')
    .replace(/:[^/]+/g, '__AIWEBTEST_DYNAMIC__');
  const normalized = tokenized
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/__AIWEBTEST_DYNAMIC__/g, '[^/]+')
    .replace(/\*/g, '.*');
  return new RegExp(`^${normalized}$`).test(pathname);
}

function deriveRunStatus(results: ScenarioResult[], infrastructureError?: Error): RunResult['status'] {
  if (infrastructureError && results.every((result) => result.status === 'blocked')) return 'blocked';
  if (results.some((result) => result.status === 'failed' || result.status === 'error')) return 'failed';
  if (results.some((result) => result.status === 'blocked')) return 'blocked';
  return 'passed';
}

function serializeError(error: Error): { name: string; message: string; stack?: string } {
  return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || 'artifact';
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
