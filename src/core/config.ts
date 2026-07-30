import path from "node:path";

import { contentDigest, stableId } from "./ids.js";
import { readJsonFile } from "./json.js";
import { createDefaultPolicy, mergeTestPolicy } from "./policy.js";
import type {
  ActionRisk,
  BrowserName,
  BrowserProfile,
  JsonObject,
  PlanApproval,
  RunScope,
  TestLevel,
  TestPolicy,
} from "./types.js";
import { isSupportedStrategy } from "../auth/index.js";
import type { RoleAuthConfig } from "../auth/index.js";

export const CONFIG_SCHEMA_VERSION = 1 as const;

export interface RoleConfigInput {
  id?: string;
  name: string;
  storageStatePath?: string;
  usernameEnv?: string;
  passwordEnv?: string;
  setupScenarioId?: string;
  default?: boolean;
  metadata?: JsonObject;
}

export interface RoleConfig extends Omit<RoleConfigInput, "storageStatePath" | "id" | "default"> {
  id: string;
  storageStatePath?: string;
  default: boolean;
}

export interface BrowserProfileInput {
  id?: string;
  browser?: BrowserName;
  headless?: boolean;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  locale?: string;
  colorScheme?: "light" | "dark" | "no-preference";
  timezoneId?: string;
  userAgent?: string;
}

export interface SourceConfigInput {
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
  maxFileSizeBytes?: number;
  followSymlinks?: boolean;
}

export interface SourceConfig extends Required<SourceConfigInput> {}

export interface RuntimeConfigInput {
  enabled?: boolean;
  headless?: boolean;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
  profiles?: BrowserProfileInput[];
  ignoreHTTPSErrors?: boolean;
  maxPages?: number;
}

export interface RuntimeConfig extends Required<Omit<RuntimeConfigInput, "profiles">> {
  profiles: BrowserProfile[];
}

export interface ArtifactConfigInput {
  directory?: string;
  retainRuns?: number;
}

export interface ArtifactConfig {
  directory: string;
  retainRuns: number;
}

/**
 * How the inventory is discovered.
 * - `static`: parse the target source tree (default; requires `rootDir`).
 * - `runtime-first`: black-box mode for targets without source access; the
 *   inventory is seeded from `baseUrl` (+ optional `seedPaths`) via browser
 *   exploration and can be topped up with `aitest inventory merge`.
 */
export type DiscoveryMode = "static" | "runtime-first";

export const DISCOVERY_MODES: readonly DiscoveryMode[] = ["static", "runtime-first"];

export interface TargetConfigInput {
  rootDir?: string;
  baseUrl?: string;
  startCommand?: string;
  workingDirectory?: string;
  environment?: string;
  env?: Record<string, string>;
  allowProductionLikeHost?: boolean;
  discovery?: DiscoveryMode;
  /** Extra seed paths for runtime-first exploration, e.g. ["/login", "/orders"]. */
  seedPaths?: string[];
}

export interface TargetConfig {
  rootDir: string;
  baseUrl?: string;
  startCommand?: string;
  workingDirectory: string;
  environment: string;
  env: Record<string, string>;
  allowProductionLikeHost: boolean;
  /** Discovery strategy; defaults to `static` so existing configs behave as before. */
  discovery: DiscoveryMode;
  /** Extra seed paths used when exploring a runtime-first target. */
  seedPaths: string[];
}

export interface AiConfigInput {
  enabled?: boolean;
  provider?: string;
  model?: string;
  apiKeyEnv?: string;
  sendSource?: boolean;
  sendScreenshots?: boolean;
  maxContextChars?: number;
}

export interface AiConfig {
  enabled: boolean;
  provider?: string;
  model?: string;
  apiKeyEnv?: string;
  sendSource: boolean;
  sendScreenshots: boolean;
  maxContextChars: number;
}

export interface PresetConfigInput {
  scope?: Partial<RunScope> & Pick<RunScope, "mode">;
  level?: TestLevel;
  roles?: string[];
  browserProfileIds?: string[];
  maxRisk?: ActionRisk;
  approval?: Partial<PlanApproval>;
}

export interface PresetConfig {
  scope: RunScope;
  level: TestLevel;
  roles: string[];
  browserProfileIds: string[];
  maxRisk: ActionRisk;
}

export interface AuthCredentialInput {
  usernameEnv?: string;
  passwordEnv?: string;
  tokenEnv?: string;
  apiKeyEnv?: string;
  extraEnv?: string[];
}

export interface AuthTargetInput {
  baseUrl?: string;
  loginUrl?: string;
  tokenUrl?: string;
  scriptPath?: string;
  storageStatePath?: string;
  headers?: Record<string, string>;
}

export interface AuthRoleConfigInput {
  id?: string;
  name: string;
  strategy?: string;
  credentials?: AuthCredentialInput;
  target?: AuthTargetInput;
  sessionMaxAgeMs?: number;
  metadata?: JsonObject;
}

export interface AuthConfigInput {
  roles?: AuthRoleConfigInput[];
}

export type AuthRoleConfig = RoleAuthConfig;

export interface AuthConfig {
  roles: AuthRoleConfig[];
}

export interface ProjectConfigInput {
  schemaVersion?: number;
  /** Short-form project name; equivalent to project.name. */
  name?: string;
  project?: { id?: string; name?: string };
  target?: TargetConfigInput;
  /** Convenience aliases accepted for small projects and generated configs. */
  rootDir?: string;
  baseUrl?: string;
  startCommand?: string;
  artifacts?: ArtifactConfigInput;
  source?: SourceConfigInput;
  runtime?: RuntimeConfigInput;
  roles?: RoleConfigInput[];
  auth?: AuthConfigInput;
  policy?: Partial<TestPolicy>;
  ai?: AiConfigInput;
  presets?: Record<string, PresetConfigInput>;
  report?: { projectDirectory?: string };
  metadata?: JsonObject;
}

export interface ProjectConfig {
  schemaVersion: 1;
  configPath?: string;
  configDir: string;
  project: { id: string; name: string };
  target: TargetConfig;
  artifacts: ArtifactConfig;
  source: SourceConfig;
  runtime: RuntimeConfig;
  roles: RoleConfig[];
  auth: AuthConfig;
  policy: TestPolicy;
  ai: AiConfig;
  presets: Record<string, PresetConfig>;
  report: { projectDirectory?: string };
  metadata?: JsonObject;
  digest: string;
}

export interface ConfigValidationIssue {
  path: string;
  code:
    | "type"
    | "required"
    | "value"
    | "format"
    | "security"
    | "duplicate"
    | "unsupported";
  message: string;
}

export interface ConfigValidationOptions {
  configDir?: string;
  configPath?: string;
}

export class ConfigValidationError extends Error {
  readonly issues: ConfigValidationIssue[];

  constructor(issues: ConfigValidationIssue[]) {
    super(`Configuration is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export async function loadConfig(filePath: string): Promise<ProjectConfig> {
  const absolutePath = path.resolve(filePath);
  const raw = await readJsonFile<unknown>(absolutePath);
  return validateConfig(raw, { configPath: absolutePath, configDir: path.dirname(absolutePath) });
}

/** Validate untrusted JSON and return a fully explicit, path-resolved config. */
export function validateConfig(input: unknown, options: ConfigValidationOptions = {}): ProjectConfig {
  const issues = collectConfigIssues(input, options);
  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }
  return buildConfig(input as ProjectConfigInput, options);
}

export function collectConfigIssues(input: unknown, options: ConfigValidationOptions = {}): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: "$", code: "type", message: "Configuration must be a JSON object." }];
  }

  if (input.schemaVersion !== undefined && (typeof input.schemaVersion !== "number" || input.schemaVersion !== CONFIG_SCHEMA_VERSION)) {
    issues.push({ path: "schemaVersion", code: "unsupported", message: `Only schema version ${CONFIG_SCHEMA_VERSION} is supported.` });
  }

  const configDir = path.resolve(options.configDir ?? process.cwd());
  if (input.target !== undefined && !isRecord(input.target)) {
    issues.push({ path: "target", code: "type", message: "target must be an object." });
  }
  const target = isRecord(input.target) ? input.target : {};
  if (target.rootDir !== undefined) validatePath(target.rootDir, "target.rootDir", issues);
  if (input.rootDir !== undefined) validatePath(input.rootDir, "rootDir", issues);
  if (target.baseUrl !== undefined) validateBaseUrl(target.baseUrl, "target.baseUrl", issues);
  if (input.baseUrl !== undefined) validateBaseUrl(input.baseUrl, "baseUrl", issues);
  if (target.startCommand !== undefined && typeof target.startCommand !== "string") {
    issues.push({ path: "target.startCommand", code: "type", message: "startCommand must be a string." });
  }
  if (target.workingDirectory !== undefined) {
    validatePath(target.workingDirectory, "target.workingDirectory", issues);
  }
  if (target.environment !== undefined && (typeof target.environment !== "string" || target.environment.trim().length === 0)) {
    issues.push({ path: "target.environment", code: "value", message: "environment must be a non-empty string." });
  }
  validateBoolean(target.allowProductionLikeHost, "target.allowProductionLikeHost", issues);
  if (target.env !== undefined) {
    validateStringMap(target.env, "target.env", issues);
  }
  if (target.discovery !== undefined && !DISCOVERY_MODES.includes(target.discovery as DiscoveryMode)) {
    issues.push({
      path: "target.discovery",
      code: "value",
      message: `discovery must be one of: ${DISCOVERY_MODES.join(", ")}.`,
    });
  }
  if (target.seedPaths !== undefined) {
    validateStringArray(target.seedPaths, "target.seedPaths", issues);
  }
  if (target.discovery === "runtime-first" && firstString(target.baseUrl, input.baseUrl) === undefined) {
    issues.push({
      path: "target.baseUrl",
      code: "value",
      message: "runtime-first discovery requires target.baseUrl (there is no source tree to analyze).",
    });
  }

  if (input.source !== undefined && !isRecord(input.source)) {
    issues.push({ path: "source", code: "type", message: "source must be an object." });
  }
  const source = isRecord(input.source) ? input.source : {};
  validatePositiveInteger(source.maxFiles, "source.maxFiles", issues, 1, 1_000_000);
  validatePositiveInteger(source.maxFileSizeBytes, "source.maxFileSizeBytes", issues, 1, 100 * 1024 * 1024);
  validateStringArray(source.include, "source.include", issues);
  validateStringArray(source.exclude, "source.exclude", issues);
  validateBoolean(source.followSymlinks, "source.followSymlinks", issues);

  if (input.runtime !== undefined && !isRecord(input.runtime)) {
    issues.push({ path: "runtime", code: "type", message: "runtime must be an object." });
  }
  const runtime = isRecord(input.runtime) ? input.runtime : {};
  validateBoolean(runtime.enabled, "runtime.enabled", issues);
  validateBoolean(runtime.headless, "runtime.headless", issues);
  validateBoolean(runtime.ignoreHTTPSErrors, "runtime.ignoreHTTPSErrors", issues);
  validatePositiveInteger(runtime.navigationTimeoutMs, "runtime.navigationTimeoutMs", issues, 100, 10 * 60_000);
  validatePositiveInteger(runtime.actionTimeoutMs, "runtime.actionTimeoutMs", issues, 100, 10 * 60_000);
  validatePositiveInteger(runtime.maxPages, "runtime.maxPages", issues, 1, 100_000);
  validateProfiles(runtime.profiles, issues);

  validateRoles(input.roles, configDir, issues);
  validateAuthRoles(input.auth, issues);
  validatePolicy(input.policy, issues);
  validateAi(input.ai, issues);
  validateArtifacts(input.artifacts, issues);
  validatePresets(input.presets, issues);

  if (input.project !== undefined && !isRecord(input.project)) {
    issues.push({ path: "project", code: "type", message: "project must be an object." });
  } else if (isRecord(input.project)) {
    if (input.project.id !== undefined && (typeof input.project.id !== "string" || input.project.id.trim().length === 0)) {
      issues.push({ path: "project.id", code: "value", message: "project.id must be a non-empty string." });
    }
    if (input.project.name !== undefined && (typeof input.project.name !== "string" || input.project.name.trim().length === 0)) {
      issues.push({ path: "project.name", code: "value", message: "project.name must be a non-empty string." });
    }
  }
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim().length === 0)) {
    issues.push({ path: "name", code: "value", message: "name must be a non-empty string." });
  }
  scanEmbeddedSecrets(input, "$", issues);
  return issues;
}

function buildConfig(input: ProjectConfigInput, options: ConfigValidationOptions): ProjectConfig {
  const configDir = path.resolve(options.configDir ?? process.cwd());
  const rawTarget = isRecord(input.target) ? input.target : {};
  const rawBaseUrl = firstString(rawTarget.baseUrl, input.baseUrl);
  const rawStartCommand = firstString(rawTarget.startCommand, input.startCommand);
  const rootDir = path.resolve(configDir, firstString(rawTarget.rootDir, input.rootDir) ?? ".");
  const workingDirectory = path.resolve(configDir, firstString(rawTarget.workingDirectory, rootDir) ?? rootDir);
  const discovery: DiscoveryMode = rawTarget.discovery === "runtime-first" ? "runtime-first" : "static";
  const target: TargetConfig = {
    rootDir,
    ...(rawBaseUrl !== undefined ? { baseUrl: rawBaseUrl } : {}),
    ...(rawStartCommand !== undefined ? { startCommand: rawStartCommand } : {}),
    workingDirectory,
    environment: firstString(rawTarget.environment) ?? "test",
    env: cloneStringMap(rawTarget.env),
    allowProductionLikeHost: rawTarget.allowProductionLikeHost === true,
    discovery,
    seedPaths: Array.isArray(rawTarget.seedPaths)
      ? rawTarget.seedPaths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
  };

  const projectName = isRecord(input.project) && typeof input.project.name === "string" && input.project.name.trim().length > 0
    ? input.project.name.trim()
    : typeof input.name === "string" && input.name.trim().length > 0
      ? input.name.trim()
      : path.basename(rootDir) || "web-project";
  const projectId = isRecord(input.project) && typeof input.project.id === "string" && input.project.id.trim().length > 0
    ? input.project.id.trim()
    : stableId("project", rootDir);

  const rawArtifacts = isRecord(input.artifacts) ? input.artifacts : {};
  const artifacts: ArtifactConfig = {
    directory: path.resolve(configDir, typeof rawArtifacts.directory === "string" ? rawArtifacts.directory : path.join(rootDir, ".ai-web-test")),
    retainRuns: typeof rawArtifacts.retainRuns === "number" ? rawArtifacts.retainRuns : 20,
  };

  const rawSource = isRecord(input.source) ? input.source : {};
  const source: SourceConfig = {
    include: cloneStringArray(rawSource.include, ["."]),
    exclude: cloneStringArray(rawSource.exclude, ["node_modules", ".git", "dist", "build", "coverage", ".ai-web-test"]),
    maxFiles: typeof rawSource.maxFiles === "number" ? rawSource.maxFiles : 20_000,
    maxFileSizeBytes: typeof rawSource.maxFileSizeBytes === "number" ? rawSource.maxFileSizeBytes : 2 * 1024 * 1024,
    followSymlinks: rawSource.followSymlinks === true,
  };

  const rawRuntime = isRecord(input.runtime) ? input.runtime : {};
  const runtime: RuntimeConfig = {
    enabled: rawRuntime.enabled ?? rawBaseUrl !== undefined,
    headless: rawRuntime.headless ?? true,
    navigationTimeoutMs: rawRuntime.navigationTimeoutMs ?? 30_000,
    actionTimeoutMs: rawRuntime.actionTimeoutMs ?? 10_000,
    profiles: buildProfiles(rawRuntime.profiles),
    ignoreHTTPSErrors: rawRuntime.ignoreHTTPSErrors ?? false,
    maxPages: rawRuntime.maxPages ?? 500,
  };

  const roles = buildRoles(input.roles, rootDir);
  const auth = { roles: buildAuthRoles(input.auth, rootDir, rawBaseUrl) };
  const policyBase = createDefaultPolicy(rawBaseUrl);
  const policy = mergeTestPolicy(policyBase, isRecord(input.policy) ? (input.policy as Partial<TestPolicy>) : {});
  if (target.allowProductionLikeHost) {
    policy.allowProductionLikeHosts = true;
  }

  const rawAi = isRecord(input.ai) ? input.ai : {};
  const ai: AiConfig = {
    enabled: rawAi.enabled ?? false,
    ...(typeof rawAi.provider === "string" ? { provider: rawAi.provider } : {}),
    ...(typeof rawAi.model === "string" ? { model: rawAi.model } : {}),
    ...(typeof rawAi.apiKeyEnv === "string" ? { apiKeyEnv: rawAi.apiKeyEnv } : {}),
    sendSource: rawAi.sendSource ?? false,
    sendScreenshots: rawAi.sendScreenshots ?? false,
    maxContextChars: rawAi.maxContextChars ?? 50_000,
  };

  const presets = buildPresets(input.presets, roles, runtime.profiles, policy);
  const metadata = input.metadata;
  const report: { projectDirectory?: string } = {};
  if (isRecord(input.report) && typeof input.report.projectDirectory === 'string') {
    report.projectDirectory = input.report.projectDirectory;
  }
  const withoutDigest = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    configDir,
    project: { id: projectId, name: projectName },
    target,
    artifacts,
    source,
    runtime,
    roles,
    auth,
    policy,
    ai,
    presets,
    report,
    ...(metadata !== undefined ? { metadata } : {}),
  };

  return {
    ...withoutDigest,
    ...(options.configPath !== undefined ? { configPath: path.resolve(options.configPath) } : {}),
    digest: contentDigest(withoutDigest),
  };
}

function validateRoles(value: unknown, configDir: string, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path: "roles", code: "type", message: "roles must be an array." });
    return;
  }
  const names = new Set<string>();
  for (const [index, role] of value.entries()) {
    const prefix = `roles[${index}]`;
    if (!isRecord(role)) {
      issues.push({ path: prefix, code: "type", message: "Role must be an object." });
      continue;
    }
    if (typeof role.name !== "string" || role.name.trim().length === 0) {
      issues.push({ path: `${prefix}.name`, code: "required", message: "Role name is required." });
    } else if (names.has(role.name)) {
      issues.push({ path: `${prefix}.name`, code: "duplicate", message: `Duplicate role name: ${role.name}.` });
    } else {
      names.add(role.name);
    }
    if (role.storageStatePath !== undefined) validatePath(role.storageStatePath, `${prefix}.storageStatePath`, issues);
    validateEnvName(role.usernameEnv, `${prefix}.usernameEnv`, issues);
    validateEnvName(role.passwordEnv, `${prefix}.passwordEnv`, issues);
    validateBoolean(role.default, `${prefix}.default`, issues);
    if (role.setupScenarioId !== undefined && typeof role.setupScenarioId !== "string") {
      issues.push({ path: `${prefix}.setupScenarioId`, code: "type", message: "setupScenarioId must be a string." });
    }
    // Keep configDir in the signature so future path checks can verify files
    // without changing this public validator's shape.
    void configDir;
  }
}

function validatePolicy(value: unknown, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path: "policy", code: "type", message: "policy must be an object." });
    return;
  }
  if (value.maxRisk !== undefined && !isRisk(value.maxRisk)) {
    issues.push({ path: "policy.maxRisk", code: "value", message: "maxRisk must be read, mutate, or destructive." });
  }
  for (const key of ["allowedHosts", "blockedHosts", "allowedActionNames", "blockedActionNames", "destructiveActionAllowlist", "productionLikeHostPatterns", "redactHeaders", "redactFields"] as const) {
    validateStringArray(value[key], `policy.${key}`, issues);
  }
  for (const key of ["allowExternalOrigins", "allowSecretPersistence", "allowTargetCodeChanges", "requireTestDataNamespace", "allowProductionLikeHosts", "confirmationRequired"] as const) {
    validateBoolean(value[key], `policy.${key}`, issues);
  }
  if (value.testDataNamespace !== undefined && (typeof value.testDataNamespace !== "string" || value.testDataNamespace.trim().length === 0)) {
    issues.push({ path: "policy.testDataNamespace", code: "value", message: "testDataNamespace must be a non-empty string." });
  }
  if (value.maxRisk === "destructive" && (!Array.isArray(value.destructiveActionAllowlist) || value.destructiveActionAllowlist.length === 0)) {
    issues.push({ path: "policy.destructiveActionAllowlist", code: "security", message: "Destructive risk requires an explicit non-empty action allowlist." });
  }
  if ((value.maxRisk === "mutate" || value.maxRisk === "destructive") && value.requireTestDataNamespace !== false && typeof value.testDataNamespace !== "string") {
    issues.push({ path: "policy.testDataNamespace", code: "security", message: "Mutating plans require a testDataNamespace." });
  }
}

function validateAi(value: unknown, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path: "ai", code: "type", message: "ai must be an object." });
    return;
  }
  for (const key of ["enabled", "sendSource", "sendScreenshots"] as const) validateBoolean(value[key], `ai.${key}`, issues);
  validatePositiveInteger(value.maxContextChars, "ai.maxContextChars", issues, 1_000, 10_000_000);
  if (value.apiKeyEnv !== undefined) validateEnvName(value.apiKeyEnv, "ai.apiKeyEnv", issues);
  if (value.enabled === true && (typeof value.provider !== "string" || value.provider.trim().length === 0)) {
    issues.push({ path: "ai.provider", code: "required", message: "An AI provider is required when ai.enabled is true." });
  }
}

function validateArtifacts(value: unknown, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path: "artifacts", code: "type", message: "artifacts must be an object." });
    return;
  }
  if (value.directory !== undefined) validatePath(value.directory, "artifacts.directory", issues);
  validatePositiveInteger(value.retainRuns, "artifacts.retainRuns", issues, 1, 10_000);
}

function validatePresets(value: unknown, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path: "presets", code: "type", message: "presets must be an object." });
    return;
  }
  for (const [name, preset] of Object.entries(value)) {
    if (!isRecord(preset)) {
      issues.push({ path: `presets.${name}`, code: "type", message: "Preset must be an object." });
      continue;
    }
    if (preset.scope !== undefined && (!isRecord(preset.scope) || typeof preset.scope.mode !== "string")) {
      issues.push({ path: `presets.${name}.scope`, code: "value", message: "Preset scope must include a mode." });
    }
    if (preset.level !== undefined && !["smoke", "standard", "regression", "exploratory"].includes(String(preset.level))) {
      issues.push({ path: `presets.${name}.level`, code: "value", message: "Preset level is invalid." });
    }
    validateStringArray(preset.roles, `presets.${name}.roles`, issues);
    validateStringArray(preset.browserProfileIds, `presets.${name}.browserProfileIds`, issues);
  }
}

function validateAuthRoles(value: unknown, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path: "auth", code: "type", message: "auth must be an object." });
    return;
  }
  if (value.roles !== undefined) {
    if (!Array.isArray(value.roles)) {
      issues.push({ path: "auth.roles", code: "type", message: "auth.roles must be an array." });
      return;
    }
    const names = new Set<string>();
    for (const [index, role] of value.roles.entries()) {
      const prefix = `auth.roles[${index}]`;
      if (!isRecord(role)) {
        issues.push({ path: prefix, code: "type", message: "Auth role must be an object." });
        continue;
      }
      if (typeof role.name !== "string" || role.name.trim().length === 0) {
        issues.push({ path: `${prefix}.name`, code: "required", message: "Auth role name is required." });
      } else if (names.has(role.name)) {
        issues.push({ path: `${prefix}.name`, code: "duplicate", message: `Duplicate auth role name: ${role.name}.` });
      } else {
        names.add(role.name);
      }
      if (role.strategy !== undefined && !isSupportedStrategy(String(role.strategy))) {
        issues.push({ path: `${prefix}.strategy`, code: "value", message: "Unknown auth strategy." });
      }
      if (role.credentials !== undefined) {
        const creds = isRecord(role.credentials) ? role.credentials : {};
        validateEnvName(creds.usernameEnv, `${prefix}.credentials.usernameEnv`, issues);
        validateEnvName(creds.passwordEnv, `${prefix}.credentials.passwordEnv`, issues);
        validateEnvName(creds.tokenEnv, `${prefix}.credentials.tokenEnv`, issues);
        validateEnvName(creds.apiKeyEnv, `${prefix}.credentials.apiKeyEnv`, issues);
        validateStringArray(creds.extraEnv, `${prefix}.credentials.extraEnv`, issues);
      }
      if (role.target !== undefined) {
        const target = isRecord(role.target) ? role.target : {};
        if (target.loginUrl !== undefined) validateBaseUrl(target.loginUrl, `${prefix}.target.loginUrl`, issues);
        if (target.tokenUrl !== undefined && typeof target.tokenUrl !== "string") {
          issues.push({ path: `${prefix}.target.tokenUrl`, code: "type", message: "tokenUrl must be a string." });
        }
        if (target.scriptPath !== undefined) validatePath(target.scriptPath, `${prefix}.target.scriptPath`, issues);
        if (target.storageStatePath !== undefined) validatePath(target.storageStatePath, `${prefix}.target.storageStatePath`, issues);
        if (target.headers !== undefined) validateStringMap(target.headers, `${prefix}.target.headers`, issues);
      }
    }
  }
}

function buildAuthRoles(value: unknown, rootDir: string, baseUrl: string | undefined): AuthRoleConfig[] {
  if (!isRecord(value) || !Array.isArray(value.roles)) return [];
  return value.roles.map((raw, index) => {
    const role = isRecord(raw) ? raw : {};
    const name = typeof role.name === "string" ? role.name.trim() : `auth-role-${index + 1}`;
    const target = isRecord(role.target) ? role.target : {};
    const credentials = isRecord(role.credentials) ? (role.credentials as AuthCredentialInput) : undefined;
    return {
      id: typeof role.id === "string" && role.id.trim().length > 0 ? role.id : stableId("auth-role", name),
      name,
      strategy: isSupportedStrategy(String(role.strategy)) ? String(role.strategy) as AuthRoleConfig["strategy"] : "auto",
      ...(credentials ? { credentials } : {}),
      target: {
        baseUrl: typeof target.baseUrl === "string" ? target.baseUrl : baseUrl ?? "",
        ...(typeof target.loginUrl === "string" ? { loginUrl: target.loginUrl } : {}),
        ...(typeof target.tokenUrl === "string" ? { tokenUrl: target.tokenUrl } : {}),
        ...(typeof target.scriptPath === "string" ? { scriptPath: path.resolve(rootDir, target.scriptPath) } : {}),
        ...(typeof target.storageStatePath === "string" ? { storageStatePath: path.resolve(rootDir, target.storageStatePath) } : {}),
        ...(isRecord(target.headers) ? { headers: cloneStringMap(target.headers) } : {}),
      },
    } satisfies AuthRoleConfig;
  });
}

function validateProfiles(value: unknown, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path: "runtime.profiles", code: "type", message: "runtime.profiles must be an array." });
    return;
  }
  const ids = new Set<string>();
  for (const [index, profile] of value.entries()) {
    const prefix = `runtime.profiles[${index}]`;
    if (!isRecord(profile)) {
      issues.push({ path: prefix, code: "type", message: "Browser profile must be an object." });
      continue;
    }
    if (profile.id !== undefined && (typeof profile.id !== "string" || profile.id.trim().length === 0)) {
      issues.push({ path: `${prefix}.id`, code: "value", message: "Profile id must be a non-empty string." });
    }
    if (profile.id !== undefined && ids.has(String(profile.id))) {
      issues.push({ path: `${prefix}.id`, code: "duplicate", message: `Duplicate browser profile id: ${profile.id}.` });
    }
    if (profile.id !== undefined) ids.add(String(profile.id));
    if (profile.browser !== undefined && !["chromium", "firefox", "webkit"].includes(String(profile.browser))) {
      issues.push({ path: `${prefix}.browser`, code: "value", message: "browser must be chromium, firefox, or webkit." });
    }
    validateBoolean(profile.headless, `${prefix}.headless`, issues);
    if (profile.viewport !== undefined) {
      if (!isRecord(profile.viewport)) {
        issues.push({ path: `${prefix}.viewport`, code: "type", message: "viewport must be an object." });
      } else {
        validatePositiveInteger(profile.viewport.width, `${prefix}.viewport.width`, issues, 320, 10_000);
        validatePositiveInteger(profile.viewport.height, `${prefix}.viewport.height`, issues, 240, 10_000);
      }
    }
    validatePositiveInteger(profile.deviceScaleFactor, `${prefix}.deviceScaleFactor`, issues, 0.1, 10);
    validateBoolean(profile.isMobile, `${prefix}.isMobile`, issues);
    validateBoolean(profile.hasTouch, `${prefix}.hasTouch`, issues);
  }
}

function buildProfiles(value: unknown): BrowserProfile[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ id: "chromium-desktop", browser: "chromium", headless: true, viewport: { width: 1440, height: 900 } }];
  }
  return value.map((raw, index) => {
    const profile = isRecord(raw) ? raw : {};
    const viewport = isRecord(profile.viewport) && typeof profile.viewport.width === "number" && typeof profile.viewport.height === "number"
      ? { width: profile.viewport.width, height: profile.viewport.height }
      : { width: 1440, height: 900 };
    return {
      id: typeof profile.id === "string" && profile.id.trim().length > 0 ? profile.id : `profile-${index + 1}`,
      browser: isBrowserName(profile.browser) ? profile.browser : "chromium",
      headless: profile.headless ?? true,
      viewport,
      ...(typeof profile.deviceScaleFactor === "number" ? { deviceScaleFactor: profile.deviceScaleFactor } : {}),
      ...(typeof profile.isMobile === "boolean" ? { isMobile: profile.isMobile } : {}),
      ...(typeof profile.hasTouch === "boolean" ? { hasTouch: profile.hasTouch } : {}),
      ...(typeof profile.locale === "string" ? { locale: profile.locale } : {}),
      ...(isColorScheme(profile.colorScheme) ? { colorScheme: profile.colorScheme } : {}),
      ...(typeof profile.timezoneId === "string" ? { timezoneId: profile.timezoneId } : {}),
      ...(typeof profile.userAgent === "string" ? { userAgent: profile.userAgent } : {}),
    } satisfies BrowserProfile;
  });
}

function buildRoles(value: unknown, rootDir: string): RoleConfig[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const role = isRecord(raw) ? raw : {};
    const name = typeof role.name === "string" ? role.name.trim() : `role-${index + 1}`;
    return {
      id: typeof role.id === "string" && role.id.trim().length > 0 ? role.id : stableId("role", name),
      name,
      ...(typeof role.storageStatePath === "string" ? { storageStatePath: path.resolve(rootDir, role.storageStatePath) } : {}),
      ...(typeof role.usernameEnv === "string" ? { usernameEnv: role.usernameEnv } : {}),
      ...(typeof role.passwordEnv === "string" ? { passwordEnv: role.passwordEnv } : {}),
      ...(typeof role.setupScenarioId === "string" ? { setupScenarioId: role.setupScenarioId } : {}),
      default: role.default === true,
      ...(isRecord(role.metadata) ? { metadata: role.metadata as JsonObject } : {}),
    } satisfies RoleConfig;
  });
}

function buildPresets(value: unknown, roles: RoleConfig[], profiles: BrowserProfile[], policy: TestPolicy): Record<string, PresetConfig> {
  if (!isRecord(value)) return {};
  const output: Record<string, PresetConfig> = {};
  for (const [name, raw] of Object.entries(value)) {
    const preset = isRecord(raw) ? raw : {};
    const rawScope = isRecord(preset.scope) ? preset.scope : {};
    const scope: RunScope = {
      mode: isScopeMode(rawScope.mode) ? rawScope.mode : "smoke",
      includeDependencies: rawScope.includeDependencies !== false,
      ...(Array.isArray(rawScope.moduleIds) ? { moduleIds: rawScope.moduleIds.filter(isString) } : {}),
      ...(Array.isArray(rawScope.routeIds) ? { routeIds: rawScope.routeIds.filter(isString) } : {}),
      ...(Array.isArray(rawScope.scenarioIds) ? { scenarioIds: rawScope.scenarioIds.filter(isString) } : {}),
      ...(Array.isArray(rawScope.tags) ? { tags: rawScope.tags.filter(isString) } : {}),
      ...(Array.isArray(rawScope.roleIds) ? { roleIds: rawScope.roleIds.filter(isString) } : {}),
      ...(Array.isArray(rawScope.changedPaths) ? { changedPaths: rawScope.changedPaths.filter(isString) } : {}),
      ...(typeof rawScope.failedRunId === "string" ? { failedRunId: rawScope.failedRunId } : {}),
      ...(Array.isArray(rawScope.excludedIds) ? { excludedIds: rawScope.excludedIds.filter(isString) } : {}),
    };
    const configuredRoles = Array.isArray(preset.roles) ? preset.roles.filter(isString) : roles.filter((role) => role.default).map((role) => role.id);
    const configuredProfiles = Array.isArray(preset.browserProfileIds) ? preset.browserProfileIds.filter(isString) : profiles.map((profile) => profile.id);
    output[name] = {
      scope,
      level: isTestLevel(preset.level) ? preset.level : "standard",
      roles: configuredRoles,
      browserProfileIds: configuredProfiles,
      maxRisk: isRisk(preset.maxRisk) ? preset.maxRisk : policy.maxRisk,
    };
  }
  return output;
}

function scanEmbeddedSecrets(value: unknown, prefix: string, issues: ConfigValidationIssue[], seen = new WeakSet<object>()): void {
  if (!isRecord(value) && !Array.isArray(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanEmbeddedSecrets(item, `${prefix}[${index}]`, issues, seen));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const keyLower = key.toLowerCase();
    const isEnvReferenceField = keyLower.endsWith("env") || keyLower.endsWith("envname");
    const isSensitiveField = /^(password|passwd|token|secret|apikey|api_key|authorization|cookie|privatekey|private_key)$/.test(keyLower);
    if (isSensitiveField && typeof item === "string" && !looksLikeEnvReference(item)) {
      issues.push({ path: `${prefix}.${key}`, code: "security", message: "Secrets must be referenced by environment-variable name, not embedded in config." });
    }
    if (isEnvReferenceField && typeof item !== "string") {
      issues.push({ path: `${prefix}.${key}`, code: "type", message: "Environment variable reference must be a string name." });
    }
    scanEmbeddedSecrets(item, `${prefix}.${key}`, issues, seen);
  }
}

function looksLikeEnvReference(value: string): boolean {
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) || /^env:[A-Za-z_][A-Za-z0-9_]*$/i.test(value);
}

function validateEnvName(value: unknown, field: string, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    issues.push({ path: field, code: "format", message: "Must be a valid environment-variable name." });
  }
}

function validateBaseUrl(value: unknown, field: string, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path: field, code: "type", message: "Must be a non-empty URL string." });
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
    if (parsed.username || parsed.password) throw new Error("credentials");
  } catch {
    issues.push({ path: field, code: "format", message: "Must be an HTTP(S) URL without embedded credentials." });
  }
}

function validatePath(value: unknown, field: string, issues: ConfigValidationIssue[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path: field, code: "value", message: "Path must be a non-empty string." });
  } else if (value.includes("\0")) {
    issues.push({ path: field, code: "format", message: "Path contains a NUL character." });
  }
}

function validateStringMap(value: unknown, field: string, issues: ConfigValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path: field, code: "type", message: "Must be an object containing string values." });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") issues.push({ path: `${field}.${key}`, code: "type", message: "Value must be a string." });
  }
}

function validateStringArray(value: unknown, field: string, issues: ConfigValidationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({ path: field, code: "type", message: "Must be an array of strings." });
  }
}

function validateBoolean(value: unknown, field: string, issues: ConfigValidationIssue[]): void {
  if (value !== undefined && typeof value !== "boolean") issues.push({ path: field, code: "type", message: "Must be a boolean." });
}

function validatePositiveInteger(value: unknown, field: string, issues: ConfigValidationIssue[], min: number, max: number): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (Number.isInteger(min) && !Number.isInteger(value))) {
    issues.push({ path: field, code: "value", message: `Must be a number between ${min} and ${max}${Number.isInteger(min) ? " (integer)" : ""}.` });
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function cloneStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function cloneStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter(isString) : [...fallback];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBrowserName(value: unknown): value is BrowserName {
  return value === "chromium" || value === "firefox" || value === "webkit";
}

function isColorScheme(value: unknown): value is NonNullable<BrowserProfile["colorScheme"]> {
  return value === "light" || value === "dark" || value === "no-preference";
}

function isRisk(value: unknown): value is ActionRisk {
  return value === "read" || value === "mutate" || value === "destructive";
}

function isTestLevel(value: unknown): value is TestLevel {
  return value === "smoke" || value === "standard" || value === "regression" || value === "exploratory";
}

function isScopeMode(value: unknown): value is RunScope["mode"] {
  return value === "full" || value === "module" || value === "route" || value === "scenario" || value === "tag" || value === "role" || value === "affected" || value === "failed" || value === "smoke";
}
