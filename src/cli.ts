#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ArtifactStore,
  ConfigValidationError,
  loadConfig,
  pathExists,
  writeJsonFile,
  type BrowserProfile,
  type Inventory,
  type ProjectConfig,
  type RunResult,
  type RunScope,
  type TestScenario,
} from './core/index.js';
import { deriveProjectId, generateOperationId, AgentError, type AgentState } from './agent/index.js';
import { authenticate, saveStorageState } from './auth/index.js';
import { createBrowserAuthSession } from './browser/auth-surface.js';
import { discoverSource } from './discovery/index.js';
import { exploreBrowser } from './browser/index.js';
import { mergeBrowserExploration, summarizeInventory } from './inventory/index.js';
import { approvePlan, proposePlan, validateApprovedPlan } from './planning/index.js';
import { generateRouteSmokeScenarios, loadScenarios, writeScenarios } from './scenarios/index.js';
import { executePlan } from './execution/index.js';
import { reportModelFromRun, writeHtmlReport, writeMarkdownReport } from './reporting/index.js';
import { getBooleanOption, getListOption, getStringOption, parseCliArgs, CliOutput, withPrompt } from './cli/index.js';
import { collectSourceExcerpts, createAiProvider, proposeScenariosWithAi, triageFailureWithAi } from './ai/index.js';
import { withTargetProcess } from './runtime/index.js';
import { startMcpServer } from './mcp/index.js';

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG_NAME = 'ai-web-test.config.json';

/** Map a completed run to the process status expected by CI and shell users. */
export function runResultExitCode(status: RunResult['status']): number {
  return status === 'passed' ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv);
  const output = new CliOutput({
    json: getBooleanOption(args, 'json'),
    quiet: getBooleanOption(args, 'quiet'),
    operationId: generateOperationId(),
  });

  try {
    switch (args.command) {
      case 'init':
        await commandInit(args, output);
        break;
      case 'discover':
        await commandDiscover(args, output);
        break;
      case 'plan':
        await commandPlan(args, output);
        break;
      case 'ai-plan':
        await commandAiPlan(args, output);
        break;
      case 'approve':
        await commandApprove(args, output);
        break;
      case 'run':
        await commandRun(args, output);
        break;
      case 'report':
        await commandReport(args, output);
        break;
      case 'analyze':
        await commandAnalyze(args, output);
        break;
      case 'status':
        await commandStatus(args, output);
        break;
      case 'auth':
        await commandAuth(args, output);
        break;
      case 'mcp':
        await commandMcp(args, output);
        break;
      case 'help':
      case '--help':
      case '-h':
      default:
        output.result(helpText());
        if (args.command !== 'help' && args.command !== '--help' && args.command !== '-h') process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      output.error(new AgentError('CONFIG_VALIDATION', `${error.message}\n${error.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`, false));
    } else {
      output.error(error);
    }
    process.exitCode = 1;
  }
}

async function commandInit(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.resolve(cwd, getStringOption(args, 'config') ?? DEFAULT_CONFIG_NAME);
  if (await pathExists(configPath) && !getBooleanOption(args, 'force')) {
    throw new Error(`Config already exists at ${configPath}. Use --force to replace it.`);
  }
  const targetArgument = args.positionals[0] ?? getStringOption(args, 'target') ?? '.';
  const targetRoot = path.resolve(cwd, targetArgument);
  const relativeTarget = path.relative(path.dirname(configPath), targetRoot) || '.';
  const projectName = getStringOption(args, 'name') ?? (path.basename(targetRoot) || 'web-project');
  const baseUrl = getStringOption(args, 'url') ?? 'http://localhost:3000';
  const startCommand = getStringOption(args, 'start') ?? 'npm run dev';
  const config = {
    schemaVersion: 1,
    project: { name: projectName },
    target: { rootDir: relativeTarget, baseUrl, startCommand },
    artifacts: { directory: path.join('.ai-web-test', projectName) },
    source: { exclude: ['node_modules', '.git', 'dist', 'build', 'coverage', '.ai-web-test'] },
    runtime: {
      enabled: true,
      headless: true,
      profiles: [{ id: 'chromium-desktop', browser: 'chromium', viewport: { width: 1440, height: 900 } }],
    },
    policy: {
      maxRisk: 'read',
      allowedHosts: [new URL(baseUrl).hostname],
      allowExternalOrigins: false,
      destructiveActionAllowlist: [],
      confirmationRequired: true,
    },
    ai: { enabled: false, sendSource: false, sendScreenshots: false },
  };
  await writeJsonFile(configPath, config);
  const relativeConfig = path.relative(cwd, configPath);
  output.setContext({ projectId: deriveProjectId({ baseUrl, rootDir: targetRoot }) });
  output.result({
    configPath,
    targetRoot,
    next: [
      `aitest discover --config ${relativeConfig} --static-only`,
      `aitest discover --config ${relativeConfig} --start`,
    ],
  }, 'initialized');
}

async function commandDiscover(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  await store.initialize();
  output.info(`Analyzing source: ${config.target.rootDir}`);
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
  if (config.runtime.enabled && config.target.baseUrl && !getBooleanOption(args, 'static-only')) {
    await withTargetProcess({
      baseUrl: config.target.baseUrl,
      ...(config.target.startCommand ? { startCommand: config.target.startCommand } : {}),
      workingDirectory: config.target.workingDirectory,
      environment: config.target.env,
      outputDir: store.layout.root,
      noStart: !getBooleanOption(args, 'start', false),
    }, async (target) => {
      if (target.started) output.info(`Started target with ${target.command}; logs: ${target.logPath}`);
      const profile = config.runtime.profiles[0];
      const screenshotDir = path.join(store.layout.root, 'discovery-screenshots');
      const exploration = await exploreBrowser({
        baseUrl: config.target.baseUrl as string,
        allowedHosts: config.policy.allowedHosts,
        blockedHosts: config.policy.blockedHosts,
        routes: draft.routes.map((route) => route.path),
        browserName: profile?.browser ?? 'chromium',
        headless: getBooleanOption(args, 'headed') ? false : profile?.headless ?? config.runtime.headless,
        viewport: profile?.viewport ?? { width: 1440, height: 900 },
        navigationTimeoutMs: config.runtime.navigationTimeoutMs,
        ignoreHTTPSErrors: config.runtime.ignoreHTTPSErrors,
        maxPages: config.runtime.maxPages,
        screenshotDir,
        captureScreenshots: config.policy.allowSecretPersistence && getBooleanOption(args, 'screenshots', false),
        redactQueryKeys: [...config.policy.redactFields, ...config.policy.redactHeaders],
      });
      runtimeStatus = exploration.status;
      inventory = mergeBrowserExploration(inventory, exploration);
      if (exploration.unavailableReason) output.warn(exploration.unavailableReason);
    });
  }
  const generatedScenarios = generateRouteSmokeScenarios(inventory, { screenshot: config.policy.allowSecretPersistence });
  const existingScenarios = await loadExistingScenarios(store);
  const scenarios = mergeScenarioCatalog(existingScenarios, generatedScenarios);
  inventory = addScenarioCoverage(inventory, scenarios);
  await store.writeInventory(inventory);
  await writeScenarios(store.resolve('scenarios.json'), scenarios);

  const summary = summarizeInventory(inventory, scenarios);
  output.result({ inventoryPath: store.layout.inventory, scenariosPath: store.resolve('scenarios.json'), runtimeStatus, summary }, 'discovered');
}

async function commandPlan(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  const inventory = await store.readInventory();
  const scenarios = await readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);
  const presetName = getStringOption(args, 'preset');
  const preset = presetName ? config.presets[presetName] : undefined;
  if (presetName && !preset) throw new Error(`Unknown configured preset: ${presetName}`);
  const scope = normalizeScopeSelectors(await chooseScope(args, inventory, scenarios, preset?.scope), inventory, scenarios);
  const browserProfiles = pickBrowserProfiles(config.runtime.profiles, getListOption(args, 'browser').length > 0 ? getListOption(args, 'browser') : preset?.browserProfileIds ?? []);
  const requestedRoles = getListOption(args, 'role').length > 0 ? getListOption(args, 'role') : preset?.roles ?? [];
  const roles = resolveRoleSelectors(requestedRoles, inventory);
  const changedPaths = scope.mode === 'affected' && (scope.changedPaths?.length ?? 0) === 0
    ? await gitChangedPaths(config.target.rootDir, getStringOption(args, 'base-ref'))
    : scope.changedPaths;
  const effectiveScope: RunScope = changedPaths === undefined ? scope : { ...scope, changedPaths };
  const failedScenarioIds = effectiveScope.mode === 'failed' && effectiveScope.failedRunId
    ? (await store.readRunResult(effectiveScope.failedRunId)).scenarios
      .filter((scenario) => scenario.status === 'failed' || scenario.status === 'error' || scenario.status === 'blocked')
      .map((scenario) => scenario.scenarioId)
    : undefined;
  const requestedRisk = parseRisk(getStringOption(args, 'max-risk'));
  const requestedLevel = parseLevel(getStringOption(args, 'level'));
  const proposed = proposePlan({
    inventory,
    scenarios,
    scope: effectiveScope,
    target: {
      baseUrl: config.target.baseUrl ?? 'http://localhost:3000',
      projectRoot: config.target.rootDir,
      environment: config.target.environment,
    },
    policy: {
      ...config.policy,
      ...(requestedRisk ? { maxRisk: requestedRisk } : preset?.maxRisk ? { maxRisk: preset.maxRisk } : {}),
    },
    browserProfiles,
    ...(roles.length > 0 ? { roles } : {}),
    level: requestedLevel ?? preset?.level ?? (scope.mode === 'smoke' ? 'smoke' : 'regression'),
    createdBy: process.env.USER ?? process.env.USERNAME ?? 'operator',
    ...(failedScenarioIds ? { selection: { failedScenarioIds } } : {}),
  });
  await store.writePlan(proposed.plan, 'proposed');
  output.setContext({ planId: proposed.plan.id });
  output.result({
    planPath: store.planPath(proposed.plan.id, 'proposed'),
    plan: {
      id: proposed.plan.id,
      name: proposed.plan.name,
      scope: proposed.plan.scope,
      scenarios: proposed.plan.scenarioIds.length,
      autoIncluded: proposed.plan.autoIncludedScenarioIds.length,
      roles: proposed.plan.roles,
      browsers: proposed.plan.browserProfiles.map((profile) => profile.id),
      maxRisk: proposed.plan.policy.maxRisk,
      target: proposed.plan.target,
      dependencyReasons: proposed.selection.dependencyReasons,
    },
    validation: proposed.validation,
    next: proposed.validation.valid ? [`aitest approve --plan ${proposed.plan.id}`] : [],
  }, 'plan_proposed');
}

async function commandAiPlan(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  const inventory = await store.readInventory();
  const scenarios = await readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);
  const provider = createAiProvider(config.ai);
  if (provider.name === 'disabled') {
    throw new Error('AI assistance is disabled. Set ai.enabled=true, ai.provider, and ai.model in the config.');
  }
  const sourceExcerpts = config.ai.sendSource
    ? await collectSourceExcerpts(inventory, config.target.rootDir, { maxChars: Math.min(config.ai.maxContextChars, 20_000) })
    : undefined;
  const response = await proposeScenariosWithAi(provider, {
    project: inventory.project.name,
    modules: inventory.nodes.filter((node) => node.kind === 'module').map((node) => ({ id: node.id, name: node.name })),
    routes: inventory.nodes.filter((node) => node.kind === 'route').map((node) => ({ id: node.id, path: node.path, ...(node.moduleId ? { moduleId: node.moduleId } : {}), confidence: node.confidence })),
    apis: inventory.nodes.filter((node) => node.kind === 'api').map((node) => ({ id: node.id, method: node.method, path: node.urlPattern, ...(node.moduleId ? { moduleId: node.moduleId } : {}) })),
    pages: inventory.nodes.filter((node) => node.kind === 'page').map((node) => ({
      id: node.id,
      name: node.name,
      routes: node.routePaths,
      ...(node.metadata?.controlSummaries ? { controls: node.metadata.controlSummaries } : {}),
      ...(node.metadata?.linkSummaries ? { links: node.metadata.linkSummaries } : {}),
    })),
    existingScenarios: scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name })),
    gaps: inventory.findings.filter((finding) => finding.category === 'coverage-gap').map((finding) => finding.summary),
    ...(sourceExcerpts === undefined ? {} : { sourceExcerpts }),
  }, {
    maxContextChars: config.ai.maxContextChars,
    additionalSecretKeys: [...config.policy.redactFields, ...config.policy.redactHeaders],
  });
  const outputPath = await store.writeJson(`ai-plans/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
    generatedAt: new Date().toISOString(),
    provider: provider.name,
    response,
    note: 'AI proposals are advisory. Review and convert approved scenarios into a run plan before execution.',
  });
  output.result({ outputPath, scenarioProposals: response.scenarios.length, coverageGaps: response.coverageGaps, questionsForOperator: response.questionsForOperator }, 'discovered');
}

async function commandApprove(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  const inventory = await store.readInventory();
  const scenarios = await readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);
  const planId = getStringOption(args, 'plan') ?? await latestPlanId(store);
  if (!planId) throw new Error('No proposed plan found. Run `aitest plan` first.');
  const proposed = await store.readPlan(planId, 'proposed');
  const yes = getBooleanOption(args, 'yes');
  if (!yes) {
    if (!process.stdin.isTTY) {
      throw new Error('Approval requires an interactive terminal or the explicit --yes flag. --non-interactive does not imply approval.');
    }
    await withPrompt(async (prompt) => {
      const approved = await prompt.confirm(
        `Approve ${proposed.name} with ${proposed.scenarioIds.length} scenarios, roles [${proposed.roles.join(', ') || 'anonymous'}], browsers [${proposed.browserProfiles.map((profile) => profile.id).join(', ')}], and up to ${proposed.policy.maxRisk}-risk actions against ${proposed.target.baseUrl}?`,
        false,
      );
      if (!approved) throw new Error('Operator declined the test plan. No test actions were executed.');
    });
  }
  const approvalInput = {
    approvedBy: getStringOption(args, 'by') ?? process.env.USER ?? process.env.USERNAME ?? 'operator',
    ...(getStringOption(args, 'note') ? { note: getStringOption(args, 'note') as string } : {}),
  };
  const approved = approvePlan(proposed, approvalInput, { inventory, scenarios });
  await store.writePlan(approved, 'approved');
  output.setContext({ planId: approved.id });
  output.result({ approvedPlanPath: store.planPath(approved.id, 'approved'), planId: approved.id, status: approved.status, approval: approved.approval }, 'plan_approved');
}

async function commandRun(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  await store.initialize();
  const inventory = await store.readInventory();
  const scenarios = await readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);
  const planId = getStringOption(args, 'plan') ?? await latestApprovedPlanId(store);
  if (!planId) throw new Error('No approved plan found. Run `aitest plan` followed by `aitest approve`.');
  const plan = await store.readPlan(planId, 'approved');
  const validation = validateApprovedPlan(plan, { inventory, scenarios });
  if (!validation.valid) throw new Error(`Approved plan is no longer valid:\n${validation.issues.map((issue) => `- ${issue.message}`).join('\n')}`);
  const storageStateByRole = buildStorageStateMap(config, inventory);
  const captureTrace = config.policy.allowSecretPersistence && getBooleanOption(args, 'trace', false);
  const captureScreenshots = config.policy.allowSecretPersistence && getBooleanOption(args, 'screenshots', false);
  if (!config.policy.allowSecretPersistence && (getBooleanOption(args, 'trace') || getBooleanOption(args, 'screenshots'))) {
    output.warn('Trace/screenshot persistence was requested but policy.allowSecretPersistence is false; sensitive artifacts will not be written.');
  }
  const result = await withTargetProcess({
    baseUrl: config.target.baseUrl ?? plan.target.baseUrl,
    ...(config.target.startCommand ? { startCommand: config.target.startCommand } : {}),
    workingDirectory: config.target.workingDirectory,
    environment: config.target.env,
    outputDir: store.layout.root,
    noStart: !getBooleanOption(args, 'start', false),
  }, async (target) => {
    if (target.started) output.info(`Started target with ${target.command}; logs: ${target.logPath}`);
    return executePlan(plan, {
      scenarios,
      inventory,
      outputDir: store.layout.runs,
      storageStateByRole,
      captureTrace,
      captureScreenshotsOnFailure: captureScreenshots,
      visualBaselineDir: store.resolve('visual-baselines'),
      updateVisualBaselines: getBooleanOption(args, 'update-baselines'),
      failOnVisualDiff: !getBooleanOption(args, 'allow-visual-diff'),
      ignoreHTTPSErrors: config.runtime.ignoreHTTPSErrors,
      defaultActionTimeoutMs: config.runtime.actionTimeoutMs,
      onProgress: (event) => {
        if (!getBooleanOption(args, 'json')) output.info(`[${event.type}] ${JSON.stringify(event).replace(/[\r\n]+/g, ' ')}`);
      },
    });
  });
  const resultPath = await store.writeRunResult(result);
  const reportModel = reportModelFromRun(result, plan, scenarios);
  const reportPath = store.runWorkspace(result.id).report;
  await writeHtmlReport(reportModel, reportPath);
  const markdownPath = store.runWorkspace(result.id).markdown;
  await writeMarkdownReport(reportModel, markdownPath);
  output.setContext({ planId: plan.id });
  const finalState: AgentState = result.status === 'passed' ? 'completed' : 'failed';
  output.result({ status: result.status, runId: result.id, resultPath, reportPath, markdownPath, coverage: result.coverage }, finalState);
  if (runResultExitCode(result.status) !== 0) process.exitCode = runResultExitCode(result.status);
}

async function commandReport(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  const runId = getStringOption(args, 'run') ?? args.positionals[0];
  if (!runId) throw new Error('Specify a run id with --run.');
  const result = await store.readRunResult(runId);
  const plan = await store.readPlan(result.planId, 'approved');
  const model = reportModelFromRun(result, plan, await readScenarioCatalog(store, await store.readInventory(), config.policy.allowSecretPersistence));
  const target = getStringOption(args, 'output') ?? store.runWorkspace(runId).report;
  await writeHtmlReport(model, target);
  const markdownTarget = target.replace(/\.html$/i, '.md');
  await writeMarkdownReport(model, markdownTarget);
  output.result({ reportPath: target, markdownPath: markdownTarget, runId }, 'completed');
}

async function commandAnalyze(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  const runId = getStringOption(args, 'run') ?? args.positionals[0];
  if (!runId) throw new Error('Specify a run id with --run.');
  const result = await store.readRunResult(runId);
  const provider = createAiProvider(config.ai);
  if (provider.name === 'disabled') throw new Error('AI assistance is disabled. Configure ai.enabled and a provider first.');
  const triage = [];
  for (const scenario of result.scenarios.filter((item) => item.status === 'failed' || item.status === 'error')) {
    const screenshotPaths = config.ai.sendScreenshots
      ? scenario.artifacts.filter((artifact) => artifact.kind === 'screenshot').map((artifact) => artifact.path)
      : [];
    const evidence = {
      testId: scenario.scenarioId,
      title: scenario.scenarioId,
      error: scenario.error?.message ?? 'Scenario failed without a top-level error.',
      consoleErrors: [
        ...metadataStringArray(scenario.metadata?.consoleErrors),
        ...metadataStringArray(scenario.metadata?.pageErrors).map((message) => `pageerror: ${message}`),
      ],
      failedRequests: metadataFailedRequests(scenario.metadata?.failedRequests),
      screenshotDescriptions: screenshotPaths,
      screenshotPaths,
    };
    const analysis = await triageFailureWithAi(provider, evidence, {
      maxContextChars: config.ai.maxContextChars,
      additionalSecretKeys: [...config.policy.redactFields, ...config.policy.redactHeaders],
    });
    triage.push({ scenarioId: scenario.scenarioId, analysis });
  }
  const outputPath = await store.writeJson(`runs/${runId}/ai-triage.json`, { runId, generatedAt: new Date().toISOString(), triage });
  output.result({ outputPath, analyzed: triage.length });
}

async function commandStatus(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  output.setContext({ projectId: deriveProjectId(config.target) });
  const store = new ArtifactStore(config.artifacts.directory);
  const inventory = await store.readInventory();
  const scenarios = await readScenarioCatalog(store, inventory, config.policy.allowSecretPersistence);
  output.result({ inventory: summarizeInventory(inventory, scenarios), artifacts: store.layout });
}

async function commandAuth(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const config = await readConfig(args);
  const roleId = getStringOption(args, 'role');
  const roles = config.auth.roles;
  const role =
    (roleId ? roles.find((candidate) => candidate.id === roleId) : undefined) ??
    roles.find((candidate) => candidate.target?.storageStatePath) ??
    roles[0];
  if (!role) {
    output.error(new AgentError('AUTH_NO_ROLE', 'No auth role configured. Add auth.roles to your config.', false));
    process.exitCode = 1;
    return;
  }

  const outputPath =
    role.target?.storageStatePath ?? path.join(config.artifacts.directory, 'auth', `${role.id}.json`);
  const session = await createBrowserAuthSession(config);
  try {
    output.setContext({ projectId: deriveProjectId(config.target) });
    const outcome = await authenticate(role, {
      env: (name) => process.env[name],
      surface: session.surface,
    });
    if (!outcome.ok) {
      output.error(new AgentError('AUTH_FAILED', outcome.reason.message, outcome.reason.retryable));
      process.exitCode = 1;
      return;
    }
    await saveStorageState(outputPath, outcome.storageState);
    output.result({
      roleId: role.id,
      strategy: outcome.strategy,
      storageStatePath: outputPath,
      warnings: outcome.warnings,
    });
  } finally {
    await session.close();
  }
}

async function readConfig(args: ReturnType<typeof parseCliArgs>): Promise<ProjectConfig> {
  const configPath = path.resolve(process.cwd(), getStringOption(args, 'config') ?? DEFAULT_CONFIG_NAME);
  return loadConfig(configPath);
}

async function readScenarioCatalog(store: ArtifactStore, inventory: Inventory, allowSecretPersistence = false): Promise<TestScenario[]> {
  const scenarioPath = store.resolve('scenarios.json');
  if (await store.exists('scenarios.json')) return loadScenarios(scenarioPath);
  const scenarios = generateRouteSmokeScenarios(inventory, { screenshot: allowSecretPersistence });
  await writeScenarios(scenarioPath, scenarios);
  return scenarios;
}

async function loadExistingScenarios(store: ArtifactStore): Promise<TestScenario[]> {
  if (!(await store.exists('scenarios.json'))) return [];
  return loadScenarios(store.resolve('scenarios.json'));
}

function mergeScenarioCatalog(existing: TestScenario[], generated: TestScenario[]): TestScenario[] {
  const userOwned = existing.filter((scenario) => scenario.source !== 'generated');
  return [...userOwned, ...generated];
}

async function chooseScope(args: ReturnType<typeof parseCliArgs>, inventory: Inventory, scenarios: TestScenario[], presetScope?: RunScope): Promise<RunScope> {
  const requested = getStringOption(args, 'scope') ?? getStringOption(args, 'mode');
  const includeDependencies = getBooleanOption(args, 'dependencies', true);
  if (!requested && presetScope) return { ...presetScope, includeDependencies: presetScope.includeDependencies !== false && includeDependencies };
  if (requested) return scopeFromArgs(requested, args, inventory, scenarios, includeDependencies);
  if (getBooleanOption(args, 'non-interactive') || !process.stdin.isTTY) return { mode: 'smoke', includeDependencies };

  return withPrompt(async (prompt) => {
    const mode = await prompt.select('Select the first approved test scope:', [
      { value: 'smoke', label: 'Smoke', description: 'Fast read-only reachability checks' },
      { value: 'module', label: 'One or more modules', description: 'Test a business area and its dependencies' },
      { value: 'scenario', label: 'Specific scenarios', description: 'Choose named business flows' },
      { value: 'affected', label: 'Code-change affected', description: 'Use Git changes and dependency mapping' },
      { value: 'full', label: 'Full inventory', description: `Run all ${scenarios.length} generated/known scenarios` },
    ] as const);
    if (mode === 'module') {
      const modules = inventory.nodes.filter((node) => node.kind === 'module').map((node) => ({ value: node.id, label: node.name, description: `${node.routeIds.length} routes · ${node.apiIds.length} APIs` }));
      return { mode, moduleIds: await prompt.multiSelect('Select modules:', modules), includeDependencies };
    }
    if (mode === 'scenario') {
      const selected = await prompt.multiSelect('Select scenarios:', scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name, description: `${scenario.risk} · ${scenario.tags.join(', ')}` })));
      return { mode, scenarioIds: selected, includeDependencies };
    }
    if (mode === 'affected') return { mode, changedPaths: await gitChangedPaths(inventory.project.rootDir, getStringOption(args, 'base-ref')), includeDependencies };
    return { mode, includeDependencies };
  });
}

function scopeFromArgs(mode: string, args: ReturnType<typeof parseCliArgs>, inventory: Inventory, scenarios: TestScenario[], includeDependencies: boolean): RunScope {
  const normalized = mode.toLowerCase() as RunScope['mode'];
  if (!['full', 'module', 'route', 'scenario', 'tag', 'role', 'affected', 'failed', 'smoke'].includes(normalized)) {
    throw new Error(`Unknown scope ${mode}.`);
  }
  const scope: RunScope = { mode: normalized, includeDependencies };
  if (normalized === 'module') scope.moduleIds = resolveModuleSelectors(getListOption(args, 'module'), inventory);
  if (normalized === 'route') scope.routeIds = resolveRouteSelectors(getListOption(args, 'route'), inventory);
  if (normalized === 'scenario') scope.scenarioIds = resolveScenarioSelectors(getListOption(args, 'scenario'), scenarios);
  if (normalized === 'tag') scope.tags = getListOption(args, 'tag');
  if (normalized === 'role') scope.roleIds = resolveRoleSelectors(getListOption(args, 'role'), inventory);
  if (normalized === 'affected') scope.changedPaths = getListOption(args, 'changed');
  if (normalized === 'failed') {
    const failedRunId = getStringOption(args, 'failed-run');
    if (failedRunId) scope.failedRunId = failedRunId;
  }
  return scope;
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

function normalizeScopeSelectors(scope: RunScope, inventory: Inventory, scenarios: TestScenario[]): RunScope {
  return {
    ...scope,
    ...(scope.moduleIds ? { moduleIds: resolveModuleSelectors(scope.moduleIds, inventory) } : {}),
    ...(scope.routeIds ? { routeIds: resolveRouteSelectors(scope.routeIds, inventory) } : {}),
    ...(scope.scenarioIds ? { scenarioIds: resolveScenarioSelectors(scope.scenarioIds, scenarios) } : {}),
    ...(scope.roleIds ? { roleIds: resolveRoleSelectors(scope.roleIds, inventory) } : {}),
  };
}

function resolveRoleSelectors(values: string[], inventory: Inventory): string[] {
  if (values.length === 0) return values;
  const roles = inventory.nodes.filter((node) => node.kind === 'role');
  return values.map((value) => roles.find((role) => role.id === value || role.name === value || role.roleKey === value)?.id ?? value);
}

function buildStorageStateMap(config: ProjectConfig, inventory: Inventory): Record<string, string> {
  const output: Record<string, string> = {};
  for (const role of config.roles) {
    if (!role.storageStatePath) continue;
    output[role.id] = role.storageStatePath;
    output[role.name] = role.storageStatePath;
    const discovered = inventory.nodes.find((node) => node.kind === 'role' && (node.id === role.id || node.name === role.name || node.roleKey === role.name));
    if (discovered) output[discovered.id] = role.storageStatePath;
  }
  return output;
}

function pickBrowserProfiles(profiles: BrowserProfile[], requested: string[]): BrowserProfile[] {
  if (requested.length === 0) return profiles;
  const selected = profiles.filter((profile) => requested.includes(profile.id) || requested.includes(profile.browser));
  if (selected.length === 0) throw new Error(`No configured browser profile matches: ${requested.join(', ')}`);
  return selected;
}

function parseRisk(value: string | undefined): 'read' | 'mutate' | 'destructive' | undefined {
  if (value === undefined) return undefined;
  if (value === 'read' || value === 'mutate' || value === 'destructive') return value;
  throw new Error(`Invalid --max-risk value ${value}. Use read, mutate, or destructive.`);
}

function parseLevel(value: string | undefined): 'smoke' | 'standard' | 'regression' | 'exploratory' | undefined {
  if (value === undefined) return undefined;
  if (value === 'smoke' || value === 'standard' || value === 'regression' || value === 'exploratory') return value;
  throw new Error(`Invalid --level value ${value}.`);
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

async function latestPlanId(store: ArtifactStore): Promise<string | undefined> {
  return latestPlanByPrefix(store, 'proposed-');
}

async function latestApprovedPlanId(store: ArtifactStore): Promise<string | undefined> {
  return latestPlanByPrefix(store, 'approved-');
}

async function latestPlanByPrefix(store: ArtifactStore, prefix: string): Promise<string | undefined> {
  let files: string[];
  try {
    files = await readdir(store.layout.plans);
  } catch {
    return undefined;
  }
  const candidates = await Promise.all(files.filter((file) => file.startsWith(prefix) && file.endsWith('.json')).map(async (file) => ({
    file,
    modified: (await stat(path.join(store.layout.plans, file))).mtimeMs,
  })));
  candidates.sort((left, right) => left.modified - right.modified);
  const latest = candidates.at(-1)?.file;
  return latest?.slice(prefix.length, -'.json'.length);
}

async function gitChangedPaths(rootDir: string, explicitBaseRef?: string): Promise<string[]> {
  try {
    const baseRef = explicitBaseRef
      ?? process.env.AI_WEB_TEST_BASE_REF
      ?? process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA
      ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);
    const commands = baseRef
      ? [['diff', '--name-only', `${baseRef}...HEAD`]]
      : [
          ['diff', '--name-only', 'HEAD'],
          ['diff', '--cached', '--name-only'],
          ['ls-files', '--others', '--exclude-standard'],
        ];
    const changed = new Set<string>();
    for (const command of commands) {
      const result = await execFileAsync('git', ['-C', rootDir, ...command], { maxBuffer: 2 * 1024 * 1024 });
      for (const item of result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) changed.add(item);
    }
    return [...changed].sort();
  } catch {
    return [];
  }
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function metadataFailedRequests(value: unknown): Array<{ method: string; url: string; status?: number; error?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.method !== 'string' || typeof record.url !== 'string') return [];
    return [{
      method: record.method,
      url: record.url,
      ...(typeof record.status === 'number' ? { status: record.status } : {}),
      ...(typeof record.error === 'string' ? { error: record.error } : {}),
    }];
  });
}

async function commandMcp(args: ReturnType<typeof parseCliArgs>, output: CliOutput): Promise<void> {
  const configPath = path.resolve(process.cwd(), getStringOption(args, 'config') ?? DEFAULT_CONFIG_NAME);
  if (!(await pathExists(configPath))) {
    throw new Error(`Config not found at ${configPath}. Use --config to specify its path.`);
  }
  // The MCP server exchanges JSON-RPC over stdio; never write human output to
  // stdout here or the protocol stream would be corrupted.
  await startMcpServer({ configPath });
}

function helpText(): string {
  return `AI Web Test — discover first, approve second, execute last

Commands:
  init [target]                       Create a safe config template
  discover                            Analyze source and optionally observe the running site
  plan --scope <mode>                 Propose full/module/route/scenario/smoke/affected plan
  ai-plan                             Ask the configured AI provider for advisory business scenarios
  analyze --run <id>                 Ask the configured AI provider to triage failed scenarios
  approve --plan <id>                 Confirm a proposed plan (interactive by default)
  run --plan <id>                     Execute an approved plan in Playwright
  report --run <id>                   Regenerate an HTML report
  status                              Show inventory and coverage summary
  auth [--role <id>]                  Authenticate a configured role and save storage state
  mcp                                 Start the MCP server (stdio) for AI clients

Common options:
  --config <path>                     Config path (default: ai-web-test.config.json)
  --json                              Emit machine-readable JSON
  --non-interactive                   Never prompt; safe scope is smoke
  --module <name-or-id>               Module selector (repeat or comma-separate)
  --scenario <id>                     Scenario selector
  --browser <profile-id>              Browser profile selector
  --preset <name>                     Use a named non-interactive config preset
  --base-ref <git-ref>                Compare affected scope with this Git base
  --update-baselines                  Explicitly accept current visual snapshots
  --start                             Explicitly run trusted target.startCommand
  --no-start                          Keep target startup disabled (the default)

Examples:
  aitest init ../my-app
  aitest discover
  aitest plan                         Ask the operator to choose the first scope
  aitest plan --scope module --module orders
  aitest approve --plan <id>
  aitest run --plan <id>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
