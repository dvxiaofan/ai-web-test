import path from 'node:path';
import { readdir } from 'node:fs/promises';
import {
  ArtifactStore,
  loadConfig,
  pathExists,
  type BrowserProfile,
  type Inventory,
  type ProjectConfig,
  type RunPlan,
  type RunPlanTarget,
  type RunResult,
  type RunScope,
  type TestPolicy,
  type TestScenario,
} from '../core/index.js';
import { discoverSource } from '../discovery/index.js';
import { exploreBrowser } from '../browser/index.js';
import { mergeBrowserExploration, summarizeInventory } from '../inventory/index.js';
import { queryInventory, type InventoryQuery } from '../inventory/queries.js';
import { approvePlan, proposePlan, validateApprovedPlan, type PlanValidationResult } from '../planning/index.js';
import {
  generateRouteSmokeScenarios,
  loadScenarios,
  writeScenarios,
} from '../scenarios/index.js';
import { executePlan } from '../execution/index.js';
import {
  buildBusinessInventory,
  computeBusinessCoverage,
  computeBusinessGaps,
  type BusinessInventory,
} from '../business/index.js';
import {
  reportModelFromRun,
  writeHtmlReport,
  writeMarkdownReport,
  type HtmlReportModel,
} from '../reporting/index.js';
import { withTargetProcess, type TargetProcessOptions } from '../runtime/index.js';
import { classifyRunFailures } from '../healing/classifier.js';
import { diffScenarios } from '../healing/semantic-diff.js';
import { evaluateHealingChanges } from '../healing/policy.js';
import { createHealingProposal } from '../healing/proposal.js';
import { loadTrendReport, type TrendReport } from '../history/trends.js';
import { applyRetentionPolicy, type RetentionPolicy, type RetentionReport } from '../history/retention.js';
import type { FailureClassification, HealingProposal } from '../healing/types.js';

/**
 * Phase 5C — orchestration service for the MCP server.
 *
 * This layer is intentionally thin: every operation delegates to the same core
 * modules the CLI uses (`discoverSource`, `proposePlan`, `approvePlan`,
 * `executePlan`, `queryInventory`, `buildBusinessInventory`, `reportModelFromRun`,
 * …). It owns only two things the CLI also owns:
 *   1. resolving the config + artifact store, and
 *   2. a handful of pure input-resolution helpers (scope/role/profile selectors,
 *      scenario-catalog merge, storage-state mapping) that were private to the
 *      CLI and are copied here verbatim so the MCP path behaves identically.
 * Because the artifact-producing core functions are shared, the reports/plans/
 * inventories an AI generates through MCP are equivalent to what the CLI would
 * produce (acceptance criterion #5).
 */

// ---------------------------------------------------------------------------
// Pure input-resolution helpers (copied verbatim from src/cli.ts so MCP and CLI
// resolve scopes/roles/profiles the same way).
// ---------------------------------------------------------------------------

type ScopeMode = RunScope['mode'];

function parseRisk(value: string | undefined): 'read' | 'mutate' | 'destructive' | undefined {
  if (value === undefined) return undefined;
  if (value === 'read' || value === 'mutate' || value === 'destructive') return value;
  throw new Error(`Invalid maxRisk value ${value}. Use read, mutate, or destructive.`);
}

function parseLevel(value: string | undefined): 'smoke' | 'standard' | 'regression' | 'exploratory' | undefined {
  if (value === undefined) return undefined;
  if (value === 'smoke' || value === 'standard' || value === 'regression' || value === 'exploratory') return value;
  throw new Error(`Invalid level value ${value}.`);
}

function resolveModuleSelectors(values: string[], inventory: Inventory): string[] {
  if (values.length === 0) return values;
  const modules = inventory.nodes.filter((node) => node.kind === 'module');
  return values.map((value) => modules.find((module) => module.id === value || module.name === value)?.id ?? value);
}

function resolveRouteSelectors(values: string[], inventory: Inventory): string[] {
  const routes = inventory.nodes.filter((node) => node.kind === 'route');
  return values.map((value) => routes.find((route) => route.id === value || route.path === value || route.name === value)?.id ?? value);
}

function resolveScenarioSelectors(values: string[], scenarios: TestScenario[]): string[] {
  return values.map((value) => scenarios.find((scenario) => scenario.id === value || scenario.name === value)?.id ?? value);
}

function resolveRoleSelectors(values: string[], inventory: Inventory): string[] {
  if (values.length === 0) return values;
  const roles = inventory.nodes.filter((node) => node.kind === 'role');
  return values.map((value) => roles.find((role) => role.id === value || role.name === value || role.roleKey === value)?.id ?? value);
}

function pickBrowserProfiles(profiles: BrowserProfile[], requested: string[]): BrowserProfile[] {
  if (requested.length === 0) return profiles;
  const selected = profiles.filter((profile) => requested.includes(profile.id) || requested.includes(profile.browser));
  if (selected.length === 0) throw new Error(`No configured browser profile matches: ${requested.join(', ')}`);
  return selected;
}

function mergeScenarioCatalog(existing: TestScenario[], generated: TestScenario[]): TestScenario[] {
  const userOwned = existing.filter((scenario) => scenario.source !== 'generated');
  return [...userOwned, ...generated];
}

async function loadExistingScenarios(store: ArtifactStore): Promise<TestScenario[]> {
  if (await store.exists('scenarios.json')) return loadScenarios(store.resolve('scenarios.json'));
  return [];
}

function addScenarioCoverage(inventory: Inventory, scenarios: TestScenario[]): Inventory {
  const scenarioNodes = scenarios.map((scenario) => ({
    id: scenario.id,
    kind: 'scenario' as const,
    name: scenario.name,
    ...(scenario.moduleIds[0] ? { moduleId: scenario.moduleIds[0] } : {}),
    tags: [...scenario.tags],
    confidence: scenario.confidence,
    evidence: scenario.evidence,
    scenarioId: scenario.id,
    routeIds: [...scenario.routeIds],
    operationIds: [...scenario.operationIds],
    roleIds: [...scenario.roleIds],
    risk: scenario.risk,
  }));
  const nonScenarios = inventory.nodes.filter((node) => node.kind !== 'scenario');
  return {
    ...inventory,
    nodes: [...nonScenarios, ...scenarioNodes],
    coverage: {
      ...inventory.coverage,
      scenarios: { discovered: scenarios.length, proposed: scenarios.length, approved: 0 },
      pages: {
        ...inventory.coverage.pages,
        withScenario: new Set(scenarios.flatMap((scenario) => scenario.routeIds)).size,
      },
    },
  };
}

function buildStorageStateMap(config: ProjectConfig, inventory: Inventory): Record<string, string> {
  const output: Record<string, string> = {};
  for (const role of config.roles) {
    if (!role.storageStatePath) continue;
    output[role.id] = role.storageStatePath;
    output[role.name] = role.storageStatePath;
    const discovered = inventory.nodes.find(
      (node) => node.kind === 'role' && (node.id === role.id || node.name === role.name || node.roleKey === role.name),
    );
    if (discovered) output[discovered.id] = role.storageStatePath;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PlanToolParams {
  scope?: ScopeMode | undefined;
  moduleIds?: string[] | undefined;
  routeIds?: string[] | undefined;
  scenarioIds?: string[] | undefined;
  tags?: string[] | undefined;
  roleIds?: string[] | undefined;
  changedPaths?: string[] | undefined;
  failedRunId?: string | undefined;
  includeDependencies?: boolean | undefined;
  level?: 'smoke' | 'standard' | 'regression' | 'exploratory' | undefined;
  maxRisk?: 'read' | 'mutate' | 'destructive' | undefined;
  browserProfileIds?: string[] | undefined;
  createdBy?: string | undefined;
}

export interface McpServiceOptions {
  configPath: string;
}

export class McpService {
  readonly configPath: string;
  private _config: ProjectConfig | undefined;
  private _store: ArtifactStore | undefined;

  constructor(options: McpServiceOptions) {
    this.configPath = path.resolve(options.configPath);
  }

  private async loadConfig(): Promise<ProjectConfig> {
    if (!this._config) this._config = await loadConfig(this.configPath);
    return this._config;
  }

  private async store(): Promise<ArtifactStore> {
    if (!this._store) {
      const config = await this.loadConfig();
      const store = new ArtifactStore(config.artifacts.directory);
      await store.initialize();
      this._store = store;
    }
    return this._store;
  }

  private async readInventory(store: ArtifactStore): Promise<Inventory> {
    let inventory: Inventory | null = null;
    try {
      inventory = await store.readInventory();
    } catch {
      inventory = null;
    }
    if (!inventory) {
      throw new Error(
        'No inventory found. Run discovery (awt_discover / `aitest discover`) before this operation.',
      );
    }
    return inventory;
  }

  private async readScenarioCatalog(
    store: ArtifactStore,
    inventory: Inventory,
    allowSecretPersistence: boolean,
  ): Promise<TestScenario[]> {
    const scenarioPath = store.resolve('scenarios.json');
    if (await store.exists('scenarios.json')) return loadScenarios(scenarioPath);
    const scenarios = generateRouteSmokeScenarios(inventory, { screenshot: allowSecretPersistence });
    await writeScenarios(scenarioPath, scenarios);
    return scenarios;
  }

  // --- status -------------------------------------------------------------

  async status(): Promise<{
    configPath: string;
    project: { id: string; name: string; rootDir?: string | undefined; baseUrl?: string | undefined };
    artifacts: string;
    ready: boolean;
    scenarioCount: number;
    summary?: ReturnType<typeof summarizeInventory>;
  }> {
    const config = await this.loadConfig();
    const store = new ArtifactStore(config.artifacts.directory);
    await store.initialize();
    let inventory: Inventory | null = null;
    try {
      inventory = await store.readInventory();
    } catch {
      inventory = null;
    }
    const scenarios = inventory
      ? await this.readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence)
      : [];
    return {
      configPath: this.configPath,
      project: {
        id: config.project.id,
        name: config.project.name,
        rootDir: config.target.rootDir,
        baseUrl: config.target.baseUrl,
      },
      artifacts: store.layout.root,
      ready: Boolean(inventory),
      scenarioCount: scenarios.length,
      ...(inventory ? { summary: summarizeInventory(inventory, scenarios) } : {}),
    };
  }

  // --- discover -----------------------------------------------------------

  async discover(params: { staticOnly?: boolean | undefined; start?: boolean | undefined } = {}): Promise<{
    inventoryPath: string;
    scenariosPath: string;
    runtimeStatus?: string;
    summary: ReturnType<typeof summarizeInventory>;
  }> {
    const config = await this.loadConfig();
    const store = await this.store();
    const draft = await discoverSource({
      rootDir: config.target.rootDir,
      projectName: config.project.name,
      ...(config.target.baseUrl ? { baseUrl: config.target.baseUrl } : {}),
      include: config.source.include,
      ignore: config.source.exclude,
      maxFiles: config.source.maxFiles,
      maxFileSizeBytes: config.source.maxFileSizeBytes,
      followSymlinks: config.source.followSymlinks,
    });

    let inventory = draft.inventory;
    let runtimeStatus: string | undefined;

    if (!params.staticOnly && config.runtime.enabled && config.target.baseUrl) {
      const profile = config.runtime.profiles[0];
      const targetOptions: TargetProcessOptions = {
        workingDirectory: config.target.workingDirectory ?? process.cwd(),
        outputDir: store.layout.root,
        noStart: !params.start,
      };
      if (config.target.baseUrl) targetOptions.baseUrl = config.target.baseUrl;
      if (config.target.startCommand) targetOptions.startCommand = config.target.startCommand;
      if (config.target.env) targetOptions.environment = config.target.env;
      await withTargetProcess(targetOptions, async (target) => {
          const exploration = await exploreBrowser({
            baseUrl: config.target.baseUrl as string,
            allowedHosts: config.policy.allowedHosts,
            blockedHosts: config.policy.blockedHosts,
            routes: draft.routes.map((route) => route.path),
            browserName: profile?.browser ?? 'chromium',
            headless: profile?.headless ?? config.runtime.headless,
            viewport: profile?.viewport ?? { width: 1440, height: 900 },
            navigationTimeoutMs: config.runtime.navigationTimeoutMs,
            ignoreHTTPSErrors: config.runtime.ignoreHTTPSErrors,
            maxPages: config.runtime.maxPages,
            screenshotDir: path.join(store.layout.root, 'discovery-screenshots'),
            captureScreenshots: false,
            redactQueryKeys: [...config.policy.redactFields, ...config.policy.redactHeaders],
          });
          runtimeStatus = exploration.status;
          inventory = mergeBrowserExploration(inventory, exploration);
        },
      );
    }

    const generatedScenarios = generateRouteSmokeScenarios(inventory, {
      screenshot: config.policy.allowSecretPersistence,
    });
    const existingScenarios = await loadExistingScenarios(store);
    const scenarios = mergeScenarioCatalog(existingScenarios, generatedScenarios);
    inventory = addScenarioCoverage(inventory, scenarios);

    await store.writeInventory(inventory);
    await writeScenarios(store.resolve('scenarios.json'), scenarios);

    return {
      inventoryPath: store.layout.inventory,
      scenariosPath: store.resolve('scenarios.json'),
      ...(runtimeStatus ? { runtimeStatus } : {}),
      summary: summarizeInventory(inventory, scenarios),
    };
  }

  // --- inventory query ----------------------------------------------------

  async inventoryQuery(params: {
    action: InventoryQuery['action'];
    id?: string | undefined;
    includeScenarios?: boolean | undefined;
  }): Promise<unknown> {
    const config = await this.loadConfig();
    const store = await this.store();
    const inventory = await this.readInventory(store);
    const scenarios = params.includeScenarios
      ? await this.readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence)
      : undefined;

    const query: InventoryQuery = { action: params.action };
    if (params.id) query.id = params.id;
    if (scenarios) query.scenarios = scenarios;

    let options: { businessInventory?: BusinessInventory } | undefined;
    if (params.action === 'business') {
      options = { businessInventory: buildBusinessInventory(inventory) };
    }
    return queryInventory(query, inventory, options);
  }

  // --- plan ---------------------------------------------------------------

  async plan(params: PlanToolParams): Promise<{
    plan: RunPlan;
    validation: PlanValidationResult;
  }> {
    const config = await this.loadConfig();
    const store = await this.store();
    const inventory = await this.readInventory(store);
    const scenarios = await this.readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);

    const scope: RunScope = {
      mode: params.scope ?? 'smoke',
      includeDependencies: params.includeDependencies ?? false,
    };
    if (params.moduleIds?.length) scope.moduleIds = resolveModuleSelectors(params.moduleIds, inventory);
    if (params.routeIds?.length) scope.routeIds = resolveRouteSelectors(params.routeIds, inventory);
    if (params.scenarioIds?.length) scope.scenarioIds = resolveScenarioSelectors(params.scenarioIds, scenarios);
    if (params.tags?.length) scope.tags = params.tags;
    if (params.roleIds?.length) scope.roleIds = resolveRoleSelectors(params.roleIds, inventory);
    if (params.changedPaths?.length) scope.changedPaths = params.changedPaths;
    if (params.failedRunId) scope.failedRunId = params.failedRunId;

    const requestedRisk = parseRisk(params.maxRisk);
    const requestedLevel = parseLevel(params.level);
    const browserProfiles = pickBrowserProfiles(config.runtime.profiles, params.browserProfileIds ?? []);
    const roles = resolveRoleSelectors(params.roleIds ?? [], inventory);
    const failedScenarioIds =
      scope.mode === 'failed' && scope.failedRunId
        ? (await store.readRunResult(scope.failedRunId)).scenarios
            .filter((scenario) => scenario.status === 'failed' || scenario.status === 'error' || scenario.status === 'blocked')
            .map((scenario) => scenario.scenarioId)
        : undefined;
    const policy: TestPolicy = {
      ...config.policy,
      ...(requestedRisk ? { maxRisk: requestedRisk } : {}),
    };
    const target: RunPlanTarget = {
      baseUrl: config.target.baseUrl ?? 'http://localhost:3000',
      projectRoot: config.target.rootDir,
      environment: config.target.environment ?? process.env.NODE_ENV,
    };

    const proposed = await proposePlan({
      inventory,
      scenarios,
      scope,
      target,
      policy,
      browserProfiles,
      ...(roles.length > 0 ? { roles } : {}),
      level: requestedLevel ?? (scope.mode === 'smoke' ? 'smoke' : 'regression'),
      createdBy: params.createdBy ?? process.env.USER ?? process.env.USERNAME ?? 'mcp',
      ...(failedScenarioIds ? { selection: { failedScenarioIds } } : {}),
    });

    await store.writePlan(proposed.plan, 'proposed');

    return {
      plan: proposed.plan,
      validation: proposed.validation,
    };
  }

  // --- approve ------------------------------------------------------------

  async approve(params: { planId?: string | undefined; by?: string | undefined; note?: string | undefined }): Promise<{
    plan: RunPlan;
  }> {
    const config = await this.loadConfig();
    const store = await this.store();
    const inventory = await this.readInventory(store);
    const scenarios = await this.readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);

    const planId = params.planId ?? (await this.latestPlanByPrefix(store, 'proposed-'));
    if (!planId) throw new Error('No proposed plan found. Run `awt_plan` first.');
    const proposed = await store.readPlan(planId, 'proposed');

    const plan = approvePlan(
      proposed,
      { approvedBy: params.by ?? 'mcp', ...(params.note ? { note: params.note } : {}) },
      { inventory, scenarios },
    );

    await store.writePlan(plan, 'approved');
    return { plan };
  }

  // --- run ----------------------------------------------------------------

  async run(params: {
    planId?: string | undefined;
    start?: boolean | undefined;
    updateBaselines?: boolean | undefined;
    allowVisualDiff?: boolean | undefined;
    captureTrace?: boolean | undefined;
    captureScreenshots?: boolean | undefined;
  }): Promise<{
    status: RunResult['status'];
    runId: string;
    resultPath: string;
    reportPath: string;
    markdownPath: string;
    coverage: RunResult['coverage'];
  }> {
    const config = await this.loadConfig();
    const store = await this.store();
    const inventory = await this.readInventory(store);
    const scenarios = await this.readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);

    const planId = params.planId ?? (await this.latestPlanByPrefix(store, 'approved-'));
    if (!planId) throw new Error('No approved plan found. Run `awt_plan` then `awt_approve`.');
    const plan = await store.readPlan(planId, 'approved');

    const validation = validateApprovedPlan(plan, { inventory, scenarios });
    if (!validation.valid) {
      throw new Error(
        `Approved plan is no longer valid:\n${validation.issues.map((issue) => `- ${issue.message}`).join('\n')}`,
      );
    }

    const storageStateByRole = buildStorageStateMap(config, inventory);

    const targetOptions: TargetProcessOptions = {
      workingDirectory: config.target.workingDirectory ?? process.cwd(),
      outputDir: store.layout.root,
      noStart: !params.start,
    };
    if (config.target.baseUrl ?? plan.target.baseUrl) {
      targetOptions.baseUrl = config.target.baseUrl ?? plan.target.baseUrl;
    }
    if (config.target.startCommand) targetOptions.startCommand = config.target.startCommand;
    if (config.target.env) targetOptions.environment = config.target.env;

    const result = await withTargetProcess(targetOptions, (target) =>
      executePlan(plan, {
          scenarios,
          inventory,
          outputDir: store.layout.runs,
          storageStateByRole,
          captureTrace: config.policy.allowSecretPersistence && Boolean(params.captureTrace),
          captureScreenshotsOnFailure: config.policy.allowSecretPersistence && Boolean(params.captureScreenshots),
          visualBaselineDir: store.resolve('visual-baselines'),
          updateVisualBaselines: Boolean(params.updateBaselines),
          failOnVisualDiff: !params.allowVisualDiff,
          ignoreHTTPSErrors: config.runtime.ignoreHTTPSErrors,
          defaultActionTimeoutMs: config.runtime.actionTimeoutMs,
        }),
    );

    const resultPath = await store.writeRunResult(result);
    const reportModel: HtmlReportModel = reportModelFromRun(result, plan, scenarios);
    const reportPath = store.runWorkspace(result.id).report;
    await writeHtmlReport(reportModel, reportPath);
    const markdownPath = store.runWorkspace(result.id).markdown;
    await writeMarkdownReport(reportModel, markdownPath);

    return {
      status: result.status,
      runId: result.id,
      resultPath,
      reportPath,
      markdownPath,
      coverage: result.coverage,
    };
  }

  // --- report -------------------------------------------------------------

  async report(params: { runId?: string | undefined; output?: string | undefined }): Promise<{
    runId: string;
    reportPath: string;
    markdownPath: string;
  }> {
    const config = await this.loadConfig();
    const store = await this.store();
    if (!params.runId) throw new Error('Specify a run id (runId).');
    const result = await store.readRunResult(params.runId);
    const plan = await store.readPlan(result.planId, 'approved');
    const inventory = await this.readInventory(store);
    const scenarios = await this.readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);

    const model = reportModelFromRun(result, plan, scenarios);
    const target = params.output ?? store.runWorkspace(result.id).report;
    await writeHtmlReport(model, target);
    const markdownPath = target.replace(/\.html$/i, '.md');
    await writeMarkdownReport(model, markdownPath);

    return { runId: result.id, reportPath: target, markdownPath };
  }

  // --- business coverage --------------------------------------------------

  async business(): Promise<{
    coverage: ReturnType<typeof computeBusinessCoverage>;
    gaps: ReturnType<typeof computeBusinessGaps>;
  }> {
    const store = await this.store();
    const inventory = await this.readInventory(store);
    const business = buildBusinessInventory(inventory);
    return {
      coverage: computeBusinessCoverage(inventory, business),
      gaps: computeBusinessGaps(inventory, business),
    };
  }

  // --- scenarios generate -------------------------------------------------

  async scenariosGenerate(): Promise<{ count: number; path: string }> {
    const config = await this.loadConfig();
    const store = await this.store();
    const inventory = await this.readInventory(store);
    const existing = await loadExistingScenarios(store);
    const generated = generateRouteSmokeScenarios(inventory, {
      screenshot: config.policy.allowSecretPersistence,
    });
    const scenarios = mergeScenarioCatalog(existing, generated);
    await writeScenarios(store.resolve('scenarios.json'), scenarios);
    return { count: scenarios.length, path: store.resolve('scenarios.json') };
  }

  // --- healing + history (Phase 6) --------------------------------------

  /**
   * Classify the failures of a run into deterministic categories with evidence.
   * Pure / read-only: reads the run result from the artifact store.
   */
  async healingClassify(args: { runId: string }): Promise<{
    runId: string;
    classifications: FailureClassification[];
  }> {
    const store = await this.store();
    const result = await store.readRunResult(args.runId);
    return { runId: args.runId, classifications: classifyRunFailures(result.scenarios) };
  }

  /**
   * Review a proposed fix (before -> after scenario) for a failing scenario in a run.
   * Reuses the run's own failure classification, runs the semantic diff + whitelist
   * policy, and returns an auditable proposal (auto-applied / requires-approval / forbidden).
   */
  async healingReview(args: {
    runId: string;
    before: TestScenario;
    after: TestScenario;
    changeNote?: string;
  }): Promise<{
    proposal: HealingProposal;
    verdict: HealingProposal['decision']['verdict'];
    status: HealingProposal['status'];
  }> {
    const store = await this.store();
    const result = await store.readRunResult(args.runId);
    const classification = classifyRunFailures(result.scenarios).find(
      (c) => c.scenarioId === args.before.id,
    );
    if (!classification) {
      throw new Error(
        `No failure classification for scenario ${args.before.id} in run ${args.runId}. ` +
          'Run awt_healing_classify / `aitest healing --run <id>` first.',
      );
    }
    const diff = diffScenarios(args.before, args.after);
    const verdict = evaluateHealingChanges(diff.changes).verdict;
    const proposal = createHealingProposal({
      runId: args.runId,
      classification,
      before: args.before,
      after: args.after,
      // Safe, whitelisted changes (verdict = auto-apply) are applied immediately;
      // meaning-shifting changes are routed through human approval.
      requireApproval: verdict !== 'auto-apply',
    });
    return { proposal, verdict: proposal.decision.verdict, status: proposal.status };
  }

  /** Build the historical trend report (pass rate / coverage / failure mix / flaky). */
  async healingTrends(args: { flakyWindow?: number } = {}): Promise<TrendReport> {
    const store = await this.store();
    return loadTrendReport(store, args);
  }

  /** Apply the artifact retention policy to the store (supports dry-run). */
  async healingRetention(args: {
    maxRuns?: number;
    maxAgeDays?: number;
    pinnedRunIds?: string[];
    dryRun?: boolean;
  }): Promise<RetentionReport> {
    const store = await this.store();
    const policy: RetentionPolicy = {
      maxRuns: args.maxRuns,
      maxAgeDays: args.maxAgeDays,
      pinnedRunIds: args.pinnedRunIds ?? [],
    };
    const retentionOptions: { dryRun?: boolean } = {};
    if (args.dryRun !== undefined) retentionOptions.dryRun = args.dryRun;
    return applyRetentionPolicy(store, policy, retentionOptions);
  }

  // --- internal helpers ---------------------------------------------------

  private async latestPlanByPrefix(store: ArtifactStore, prefix: string): Promise<string | undefined> {
    const planDir = path.join(store.layout.plans, prefix.replace(/-$/, ''));
    if (!(await pathExists(planDir))) return undefined;
    const files = (await readdir(planDir)).filter((file) => file.endsWith('.json'));
    files.sort();
    return files.at(-1)?.replace(/\.json$/, '');
  }
}
