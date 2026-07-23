import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Locator, Page, Response } from 'playwright';

import {
  assertActionAllowed,
  contentDigest,
  PolicyViolationError,
  stableId,
  type ArtifactRef,
  type AssertionResult,
  type BrowserProfile,
  type ActionRisk,
  type Finding,
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
import {
  evaluateRequestAccess,
  type RequestAccessDecision,
} from '../browser/host-policy.js';
import { computePlanDigest, computeScenarioDigest } from '../planning/approval.js';
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

interface RuntimeExecutionEvidence {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ method: string; url: string; error?: string; status?: number }>;
  visitedUrls: string[];
}

export async function executePlan(plan: RunPlan, options: ExecutePlanOptions): Promise<RunResult> {
  assertApprovedPlan(plan, options.scenarios);
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
  const findings = buildExecutionFindings(runId, scenarioResults, endedAt.toISOString());
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
    findings,
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
  if (role !== 'anonymous' && !storageState) {
    return blockedScenarioResult(
      scenario,
      profile.id,
      role,
      new Error(`Role ${role} has no Playwright storage state. Generate an isolated test-account state before running authenticated scenarios.`),
    );
  }
  const context = await createContext(browser, profile, storageState, options.ignoreHTTPSErrors ?? false);
  const activeStepRisk: { risk: ActionRisk } = { risk: scenario.risk };
  let blockedRequestCount = 0;
  let latestRequestViolation: RequestAccessDecision | undefined;
  const runtimeEvidence: RuntimeExecutionEvidence = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    visitedUrls: [],
  };
  await installExecutionRequestGuard(
    context,
    plan,
    scenario.risk,
    activeStepRisk,
    (decision) => {
      blockedRequestCount += 1;
      latestRequestViolation = decision;
    },
  );
  const observedPages = new WeakSet<Page>();
  const observeOpenedPage = (openedPage: Page) => {
    if (observedPages.has(openedPage)) return;
    observedPages.add(openedPage);
    attachRuntimeEvidence(openedPage, runtimeEvidence, plan.policy.redactFields);
  };
  context.on('page', observeOpenedPage);
  const tracePath = path.join(scenarioDir, 'trace.zip');
  const captureTrace = shouldPersistSensitiveArtifact(plan, options.captureTrace);
  const captureFailureScreenshot = shouldPersistSensitiveArtifact(plan, options.captureScreenshotsOnFailure);
  if (captureTrace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  observeOpenedPage(page);
  const responses: Response[] = [];
  page.on('response', (response) => responses.push(response));
  page.on('response', (response) => {
    if (response.status() >= 400 && runtimeEvidence.failedRequests.length < 100) {
      runtimeEvidence.failedRequests.push({
        method: response.request().method(),
        url: redactRuntimeUrl(response.url(), plan.policy.redactFields),
        status: response.status(),
      });
    }
  });

  const stepResults: StepResult[] = [];
  let scenarioError: Error | undefined;
  try {
    for (const step of scenario.steps) {
      activeStepRisk.risk = step.risk;
      const violationsBeforeStep = blockedRequestCount;
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
      // Background work from a completed step must not inherit a more
      // permissive risk level while the next step is being prepared.
      activeStepRisk.risk = scenario.risk;
      if (stepResult.status !== 'blocked' && blockedRequestCount > violationsBeforeStep) {
        const error = requestViolationError(latestRequestViolation);
        stepResult.status = 'blocked';
        stepResult.error = serializeError(error);
      }
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
  if (scenarioError === undefined && blockedRequestCount > 0) {
    scenarioError = requestViolationError(latestRequestViolation);
  }

  const artifacts: ArtifactRef[] = [];
  if (scenarioError && captureFailureScreenshot) {
    const screenshotPath = path.join(scenarioDir, 'failure.png');
    const saved = await page.screenshot({ path: screenshotPath, fullPage: true }).then(() => true).catch(() => false);
    if (saved) artifacts.push({ path: screenshotPath, kind: 'screenshot', mimeType: 'image/png' });
  }
  if (captureTrace) {
    const saved = await context.tracing.stop({ path: tracePath }).then(() => true).catch(() => false);
    if (saved) artifacts.push({ path: tracePath, kind: 'trace', mimeType: 'application/zip' });
  }
  await context.close();

  const endedAt = new Date();
  const blocked = blockedRequestCount > 0 || stepResults.some((step) => step.status === 'blocked');
  const status: ScenarioResult['status'] = blocked ? 'blocked' : scenarioError ? 'failed' : 'passed';
  const observedApis = responses
    .filter((response) => ['xhr', 'fetch'].includes(response.request().resourceType()))
    .map((response) => ({
      method: response.request().method(),
      url: redactRuntimeUrl(response.url(), plan.policy.redactFields),
      status: response.status(),
    }));
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
    metadata: {
      observedApis,
      blockedRequestCount,
      consoleErrors: runtimeEvidence.consoleErrors,
      pageErrors: runtimeEvidence.pageErrors,
      failedRequests: runtimeEvidence.failedRequests,
      visitedUrls: runtimeEvidence.visitedUrls,
    },
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
    if (step.action === 'screenshot' && !context.plan.policy.allowSecretPersistence) {
      throw new PolicyViolationError(
        { name: step.name?.trim() || step.id, risk: step.risk },
        {
          allowed: false,
          code: 'action-blocked',
          reason: 'Screenshot and visual artifact persistence are disabled by the run policy.',
        },
      );
    }
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
        const baselineKey = namespacedBaselineKey(context, step.baselineKey ?? step.id);
        const visual = await compareOrCreateVisualSnapshot(screenshotPath, {
          ...(context.visualBaselineDir ? { baselineDir: context.visualBaselineDir } : {}),
          baselineKey,
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
      default:
        // Scenario files are untrusted runtime input. Keep this guard even
        // though the TypeScript union makes the branch unreachable for typed
        // callers; an unknown JSON action must never be reported as passed.
        throw new Error(`Unsupported scenario action: ${String((step as { action?: unknown }).action)}`);
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
    // Service workers can issue requests outside page routing. Blocking them
    // keeps the context-level origin/method guard authoritative.
    serviceWorkers: 'block',
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

interface ExecutionRequestPolicy {
  baseUrl: string;
  allowedHosts: string[];
  blockedHosts: string[];
  allowExternalOrigins: boolean;
  maxRisk: RunPlan['policy']['maxRisk'];
}

/** Sensitive browser evidence is opt-in twice: caller request and policy. */
export function shouldPersistSensitiveArtifact(
  plan: Pick<RunPlan, 'policy'>,
  requested: boolean | undefined,
): boolean {
  return requested === true && plan.policy.allowSecretPersistence === true;
}

/** Install the network boundary before the first page is created. */
export async function installExecutionRequestGuard(
  context: BrowserContext,
  plan: Pick<RunPlan, 'target' | 'policy'>,
  scenarioRisk: ActionRisk = plan.policy.maxRisk,
  activeStepRisk?: { risk: ActionRisk },
  onBlocked?: (decision: RequestAccessDecision) => void,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const effectiveRisk = minimumRisk(plan.policy.maxRisk, scenarioRisk, activeStepRisk?.risk);
    const policy = requestPolicyFromPlan(plan, effectiveRisk);
    const decision = evaluateRequestAccess(request.url(), request.method(), policy);
    if (!decision.allowed) {
      onBlocked?.(decision);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  if (typeof context.routeWebSocket !== 'function') {
    throw new Error('This Playwright version cannot enforce WebSocket policy. Upgrade Playwright before executing scenarios.');
  }
  await context.routeWebSocket('**/*', async (webSocketRoute) => {
    const effectiveRisk = minimumRisk(plan.policy.maxRisk, scenarioRisk, activeStepRisk?.risk);
    const policy = requestPolicyFromPlan(plan, effectiveRisk);
    const decision = evaluateRequestAccess(webSocketRoute.url(), 'WEBSOCKET', policy);
    if (!decision.allowed) {
      onBlocked?.(decision);
      await webSocketRoute.close({ code: 1008, reason: 'Blocked by AI Web Test policy' });
      return;
    }
    webSocketRoute.connectToServer();
  });
}

function requestViolationError(decision: RequestAccessDecision | undefined): PolicyViolationError {
  const method = decision?.method || 'UNKNOWN';
  const origin = decision?.origin || 'unknown origin';
  const reason = decision?.reason;
  const reasonLabel = reason ?? 'request-policy-violation';
  return new PolicyViolationError(
    { name: `HTTP ${method} ${origin}`, risk: decision?.risk ?? 'destructive' },
    {
      allowed: false,
      code: requestViolationCode(reason),
      reason: `Browser request blocked by policy (${reasonLabel}): ${method} ${origin}.`,
    },
  );
}

function requestViolationCode(reason: RequestAccessDecision['reason'] | undefined): 'risk-exceeds-plan' | 'invalid-url' | 'host-blocked' | 'external-origin-blocked' {
  if (reason === 'request-method-blocked') return 'risk-exceeds-plan';
  if (reason === 'blocked-host') return 'host-blocked';
  if (reason === 'external-host') return 'external-origin-blocked';
  return 'invalid-url';
}

function requestPolicyFromPlan(
  plan: Pick<RunPlan, 'target' | 'policy'>,
  maxRisk = plan.policy.maxRisk,
): ExecutionRequestPolicy {
  return {
    baseUrl: plan.target.baseUrl,
    allowedHosts: [...plan.policy.allowedHosts],
    blockedHosts: [...plan.policy.blockedHosts],
    allowExternalOrigins: plan.policy.allowExternalOrigins,
    maxRisk,
  };
}

function minimumRisk(...risks: Array<ActionRisk | undefined>): ActionRisk {
  const available = risks.filter((risk): risk is ActionRisk => risk !== undefined);
  return available.reduce((minimum, risk) => (riskRank(risk) < riskRank(minimum) ? risk : minimum), 'destructive' as ActionRisk);
}

function riskRank(risk: ActionRisk): number {
  switch (risk) {
    case 'read':
      return 0;
    case 'mutate':
      return 1;
    case 'destructive':
      return 2;
  }
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

function assertApprovedPlan(plan: RunPlan, scenarios: readonly TestScenario[]): void {
  if (plan.status !== 'approved' || !plan.approval) {
    throw new Error(`Run plan ${plan.id} is not approved. Refusing to execute browser actions.`);
  }
  if (plan.approval.inventoryDigest !== plan.inventoryDigest) {
    throw new Error('Run plan approval does not match its inventory digest. Re-plan and approve again.');
  }
  if (plan.approval.policyDigest !== contentDigest(plan.policy)) {
    throw new Error('Run plan policy changed after approval. Re-plan and approve again.');
  }
  if (plan.approval.scenarioDigest !== plan.scenarioDigest) {
    throw new Error('Run plan scenario definitions changed after approval. Re-plan and approve again.');
  }
  if (computeScenarioDigest(scenarios, plan.scenarioIds) !== plan.scenarioDigest) {
    throw new Error('Run plan scenario catalog changed after approval. Re-plan and approve again.');
  }
  if (plan.approval.planDigest !== plan.digest || plan.digest !== computePlanDigest(plan)) {
    throw new Error('Run plan contents changed after approval. Re-plan and approve again.');
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
  const visitedRouteIds = matchVisitedRouteIds(results, inventory, routeIds);
  const unresolvedIds = [...routeIds].filter((id) => knownRouteIds.size > 0 && !visitedRouteIds.has(id));
  const observedApiIds = matchObservedApiIds(results, inventory);
  const assertedApiIds = new Set(scenarios.filter((scenario) => scenario.steps.some((step) => step.action === 'assert' && step.assertion === 'status')).flatMap((scenario) => scenario.operationIds));
  const failedVisitedRouteIds = [...failedRouteIds].filter((id) => visitedRouteIds.has(id));
  return {
    routes: {
      selected: routeIds.size,
      visited: visitedRouteIds.size,
      passed: [...passedRouteIds].filter((id) => visitedRouteIds.has(id)).length,
    },
    pages: {
      selected: routeIds.size,
      rendered: Math.max(0, visitedRouteIds.size - failedVisitedRouteIds.length),
      failed: failedVisitedRouteIds.length,
    },
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

function matchVisitedRouteIds(
  results: ScenarioResult[],
  inventory: Inventory | undefined,
  selectedRouteIds: ReadonlySet<string>,
): Set<string> {
  const matched = new Set<string>();
  if (!inventory) return matched;
  const routes = inventory.nodes.filter((node): node is Extract<Inventory['nodes'][number], { kind: 'route' }> => node.kind === 'route');
  for (const result of results) {
    const visitedUrls = result.metadata?.visitedUrls;
    if (!Array.isArray(visitedUrls)) continue;
    for (const rawUrl of visitedUrls) {
      if (typeof rawUrl !== 'string') continue;
      let pathname = rawUrl;
      try { pathname = new URL(rawUrl).pathname; } catch { /* keep a relative path */ }
      for (const route of routes) {
        if (selectedRouteIds.has(route.id) && routePathMatches(route.path, pathname)) matched.add(route.id);
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

function routePathMatches(pattern: string, pathname: string): boolean {
  const tokenized = pattern
    .replace(/\[\.\.\.[^\]]+\]/g, '__AIWEBTEST_DYNAMIC__')
    .replace(/\[[^\]]+\]/g, '__AIWEBTEST_DYNAMIC__')
    .replace(/:[^/]+/g, '__AIWEBTEST_DYNAMIC__')
    .replace(/\*/g, '__AIWEBTEST_DYNAMIC__');
  const normalized = tokenized
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/__AIWEBTEST_DYNAMIC__/g, '[^/]+');
  const normalizedPattern = normalized === '/' ? '/' : normalized.replace(/\/$/, '');
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  return new RegExp(`^${normalizedPattern}$`).test(normalizedPath);
}

function attachRuntimeEvidence(page: Page, evidence: RuntimeExecutionEvidence, redactFields: readonly string[]): void {
  page.on('console', (message) => {
    if (message.type() === 'error' && evidence.consoleErrors.length < 100) {
      evidence.consoleErrors.push(redactRuntimeText(message.text(), redactFields));
    }
  });
  page.on('pageerror', (error) => {
    if (evidence.pageErrors.length < 100) evidence.pageErrors.push(redactRuntimeText(error.message, redactFields));
  });
  page.on('requestfailed', (request) => {
    if (evidence.failedRequests.length >= 100) return;
    const failure = request.failure()?.errorText;
    evidence.failedRequests.push({
      method: request.method(),
      url: redactRuntimeUrl(request.url(), redactFields),
      ...(failure === undefined ? {} : { error: redactRuntimeText(failure, redactFields) }),
    });
  });
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() || evidence.visitedUrls.length >= 100) return;
    const url = redactRuntimeUrl(frame.url(), redactFields);
    if (!evidence.visitedUrls.includes(url)) evidence.visitedUrls.push(url);
  });
}

function namespacedBaselineKey(context: ScenarioExecutionContext, key: string): string {
  const viewport = `${context.profile.viewport.width}x${context.profile.viewport.height}`;
  const colorScheme = context.profile.colorScheme ?? 'no-preference';
  return `${context.role}/${context.profile.id}/${viewport}/${colorScheme}/${key}`;
}

function redactRuntimeText(value: string, redactFields: readonly string[]): string {
  let output = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|pk_live_|pk_test_)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  for (const field of redactFields) {
    if (!field.trim()) continue;
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`(${escaped}\\s*[:=]\\s*)([^\\s,;]+)`, 'gi'), '$1[REDACTED]');
  }
  return output;
}

function redactRuntimeUrl(rawUrl: string, redactFields: readonly string[]): string {
  try {
    const url = new URL(rawUrl);
    const sensitive = new Set([
      'token',
      'access_token',
      'refresh_token',
      'password',
      'secret',
      'key',
      ...redactFields.map((field) => field.toLowerCase()),
    ]);
    for (const key of [...url.searchParams.keys()]) {
      if (sensitive.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return redactRuntimeText(rawUrl, redactFields);
  }
}

function buildExecutionFindings(runId: string, results: readonly ScenarioResult[], now: string): Finding[] {
  const findings: Finding[] = [];
  const add = (
    result: ScenarioResult,
    category: Finding['category'],
    severity: Finding['severity'],
    title: string,
    summary: string,
  ) => {
    const id = stableId('finding', `${runId}:${result.scenarioId}:${result.role}:${result.browserProfileId}:${title}:${summary}`);
    findings.push({
      id,
      category,
      classification: category === 'environment' ? 'environment-failure' : 'probable-defect',
      severity,
      status: 'open',
      confidence: 0.9,
      title,
      summary,
      evidence: [{
        id: stableId('evidence', id),
        kind: 'runtime',
        summary,
        confidence: 1,
        observedAt: now,
        metadata: { role: result.role, browserProfileId: result.browserProfileId },
      }],
      relatedIds: [result.scenarioId],
      createdAt: now,
      fingerprint: id,
    });
  };

  for (const result of results) {
    for (const message of metadataStrings(result.metadata?.pageErrors).slice(0, 20)) {
      add(result, 'defect', 'high', `Page error in ${result.scenarioId}`, message);
    }
    for (const message of metadataStrings(result.metadata?.consoleErrors).slice(0, 20)) {
      add(result, 'defect', 'medium', `Console error in ${result.scenarioId}`, message);
    }
    if (result.status !== 'blocked') {
      for (const request of metadataRequests(result.metadata?.failedRequests).slice(0, 20)) {
        add(
          result,
          'environment',
          request.status !== undefined && request.status >= 500 ? 'high' : 'medium',
          `Request failed in ${result.scenarioId}`,
          `${request.method} ${request.url}: ${request.error ?? request.status ?? 'failed'}`,
        );
      }
    }
  }
  return findings;
}

function metadataStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function metadataRequests(value: unknown): Array<{ method: string; url: string; status?: number; error?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const request = item as Record<string, unknown>;
    if (typeof request.method !== 'string' || typeof request.url !== 'string') return [];
    return [{
      method: request.method,
      url: request.url,
      ...(typeof request.status === 'number' ? { status: request.status } : {}),
      ...(typeof request.error === 'string' ? { error: request.error } : {}),
    }];
  });
}

function deriveRunStatus(results: ScenarioResult[], infrastructureError?: Error): RunResult['status'] {
  if (infrastructureError && results.every((result) => result.status === 'blocked')) return 'blocked';
  if (results.some((result) => result.status === 'failed' || result.status === 'error')) return 'failed';
  if (results.some((result) => result.status === 'blocked')) return 'blocked';
  return 'passed';
}

function serializeError(error: Error): { name: string; message: string; stack?: string } {
  return {
    name: error.name,
    message: redactRuntimeText(error.message, []),
    ...(error.stack ? { stack: redactRuntimeText(error.stack, []) } : {}),
  };
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
