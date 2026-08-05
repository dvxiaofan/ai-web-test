/**
 * Canonical, JSON-friendly domain types used by every stage of AI Web Test.
 *
 * The core package intentionally contains no Playwright or AI-provider types.
 * Keeping the interchange model independent makes inventories, plans and run
 * results useful to both humans and agent integrations.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type IsoDateTime = string;
export type Confidence = number;

export type ActionRisk = "read" | "mutate" | "destructive";

export type EvidenceKind = "source" | "runtime" | "operator" | "ai" | "artifact";

export interface SourceLocation {
  filePath: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  summary: string;
  confidence: Confidence;
  observedAt?: IsoDateTime;
  uri?: string;
  source?: SourceLocation;
  artifactPath?: string;
  metadata?: JsonObject;
}

export type FindingCategory =
  | "defect"
  | "environment"
  | "flaky"
  | "coverage-gap"
  | "security"
  | "accessibility"
  | "visual"
  | "discovery"
  | "performance";

export type FindingClassification =
  | "confirmed-defect"
  | "probable-defect"
  | "environment-failure"
  | "flaky-behavior"
  | "coverage-gap"
  | "inferred";

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "confirmed" | "dismissed" | "resolved";

export interface Finding {
  id: string;
  category: FindingCategory;
  classification: FindingClassification;
  severity: FindingSeverity;
  status: FindingStatus;
  confidence: Confidence;
  title: string;
  summary: string;
  details?: string;
  evidence: EvidenceRef[];
  relatedIds: string[];
  source?: SourceLocation;
  fingerprint?: string;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
  metadata?: JsonObject;
}

/** A cross-module end-to-end flow tracked at project level. */
export interface ProjectOverviewFlow {
  name: string;
  steps: string[];
  status: "passed" | "failed" | "blocked" | "not-run";
  scenarioIds: string[];
  notes?: string;
}

export interface ProjectOverviewNextStep {
  priority: "high" | "medium" | "low";
  text: string;
}

export interface ProjectOverviewAcceptanceItem {
  item: string;
  done: boolean;
  notes?: string;
}

export interface ProjectOverviewConclusion {
  at: IsoDateTime;
  text: string;
}

/**
 * Project-level narrative that survives across runs: end-to-end flow results,
 * next steps, acceptance checklist and staged conclusions.
 *
 * Static project facts (intro, tech stack, conventions, business systems)
 * belong to `ProjectConfig.metadata.overview` instead — they are inputs, not
 * test outputs.
 */
export interface ProjectOverview {
  schemaVersion: 1;
  updatedAt: IsoDateTime;
  e2eFlows: ProjectOverviewFlow[];
  nextSteps: ProjectOverviewNextStep[];
  acceptance: ProjectOverviewAcceptanceItem[];
  conclusions: ProjectOverviewConclusion[];
  metadata?: JsonObject;
}

export type InventoryNodeKind =
  | "project"
  | "module"
  | "route"
  | "page"
  | "component"
  | "api"
  | "role"
  | "scenario"
  | "store"
  | "guard"
  | "test";

export interface InventoryNodeBase {
  id: string;
  kind: InventoryNodeKind;
  name: string;
  description?: string;
  moduleId?: string;
  tags: string[];
  confidence: Confidence;
  evidence: EvidenceRef[];
  metadata?: JsonObject;
}

export interface ProjectInventoryNode extends InventoryNodeBase {
  kind: "project";
  rootDir: string;
  framework?: string;
  packageManager?: string;
}

export interface ModuleInventoryNode extends InventoryNodeBase {
  kind: "module";
  sourcePaths: string[];
  routeIds: string[];
  apiIds: string[];
}

export interface RouteInventoryNode extends InventoryNodeBase {
  kind: "route";
  path: string;
  methods?: string[];
  entryFile?: string;
  pageId?: string;
  requiresAuth: boolean;
  roleIds: string[];
}

export interface PageInventoryNode extends InventoryNodeBase {
  kind: "page";
  routePaths: string[];
  entryFile?: string;
  componentIds: string[];
  operationIds: string[];
}

export interface ComponentInventoryNode extends InventoryNodeBase {
  kind: "component";
  sourceFile?: string;
  componentType?: "page" | "layout" | "form" | "table" | "modal" | "widget" | "unknown";
  interactive: boolean;
}

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "QUERY" | string;

export interface ApiInventoryNode extends InventoryNodeBase {
  kind: "api";
  method: ApiMethod;
  urlPattern: string;
  operationName?: string;
  sourceFile?: string;
  observed: boolean;
  requestSchema?: JsonObject;
  responseSchema?: JsonObject;
}

export interface RoleInventoryNode extends InventoryNodeBase {
  kind: "role";
  roleKey: string;
  permissions: string[];
  authenticated: boolean;
}

export interface ScenarioInventoryNode extends InventoryNodeBase {
  kind: "scenario";
  scenarioId: string;
  routeIds: string[];
  operationIds: string[];
  roleIds: string[];
  risk: ActionRisk;
}

export interface StoreInventoryNode extends InventoryNodeBase {
  kind: "store";
  sourceFile?: string;
  storeType?: string;
}

export interface GuardInventoryNode extends InventoryNodeBase {
  kind: "guard";
  sourceFile?: string;
  guardedPaths: string[];
  roleIds: string[];
}

export interface TestInventoryNode extends InventoryNodeBase {
  kind: "test";
  sourceFile?: string;
  framework?: string;
  scenarioIds: string[];
}

export type InventoryNode =
  | ProjectInventoryNode
  | ModuleInventoryNode
  | RouteInventoryNode
  | PageInventoryNode
  | ComponentInventoryNode
  | ApiInventoryNode
  | RoleInventoryNode
  | ScenarioInventoryNode
  | StoreInventoryNode
  | GuardInventoryNode
  | TestInventoryNode;

/**
 * Short aliases for the per-kind inventory nodes. The business inventory layer
 * (`src/business/`) imports these names, and they read more naturally than the
 * `*InventoryNode` form in narrowed type guards (`n is RouteNode`).
 */
export type ModuleNode = ModuleInventoryNode;
export type RouteNode = RouteInventoryNode;
export type ApiNode = ApiInventoryNode;
export type PageNode = PageInventoryNode;
export type RoleNode = RoleInventoryNode;

export type InventoryRelationship =
  | "contains"
  | "renders"
  | "navigates-to"
  | "calls"
  | "requires-role"
  | "guarded-by"
  | "depends-on"
  | "covers"
  | "triggers"
  | "prepares"
  | "asserts";

export interface InventoryEdge {
  id: string;
  from: string;
  to: string;
  relationship: InventoryRelationship;
  confidence: Confidence;
  evidence: EvidenceRef[];
  metadata?: JsonObject;
}

export interface InventoryCoverage {
  routes: { discovered: number; visited: number; rendered: number };
  pages: { discovered: number; rendered: number; withScenario: number };
  apis: { discovered: number; observed: number; asserted: number };
  roles: { configured: number; exercised: number };
  scenarios: { discovered: number; proposed: number; approved: number };
  unresolved: number;
}

export interface InventoryProject {
  id: string;
  name: string;
  rootDir: string;
  baseUrl?: string;
  framework?: string;
  packageManager?: string;
}

export interface Inventory {
  schemaVersion: 1;
  id: string;
  project: InventoryProject;
  generatedAt: IsoDateTime;
  sourceDigest?: string;
  runtimeBaseUrl?: string;
  nodes: InventoryNode[];
  edges: InventoryEdge[];
  findings: Finding[];
  coverage: InventoryCoverage;
  metadata?: JsonObject;
}

export type LocatorStrategy =
  | "role"
  | "label"
  | "text"
  | "testId"
  | "placeholder"
  | "css"
  | "xpath"
  | "url"
  | "relative";

export interface LocatorTarget {
  strategy: LocatorStrategy;
  value: string;
  name?: string;
  exact?: boolean;
  nth?: number;
}

export interface ScenarioStepBase {
  id: string;
  name?: string;
  risk: ActionRisk;
  timeoutMs?: number;
  locator?: LocatorTarget;
  metadata?: JsonObject;
}

export interface NavigateStep extends ScenarioStepBase {
  action: "navigate";
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

export interface ClickStep extends ScenarioStepBase {
  action: "click";
  locator: LocatorTarget;
  button?: "left" | "middle" | "right";
  clickCount?: number;
}

export interface FillStep extends ScenarioStepBase {
  action: "fill";
  locator: LocatorTarget;
  value: string;
  sensitive?: boolean;
}

export interface SelectOptionStep extends ScenarioStepBase {
  action: "select-option";
  locator: LocatorTarget;
  value: string | string[];
}

export interface CheckStep extends ScenarioStepBase {
  action: "check";
  locator: LocatorTarget;
}

export interface UncheckStep extends ScenarioStepBase {
  action: "uncheck";
  locator: LocatorTarget;
}

export interface PressStep extends ScenarioStepBase {
  action: "press";
  locator: LocatorTarget;
  key: string;
}

export interface WaitStep extends ScenarioStepBase {
  action: "wait";
  durationMs?: number;
  for?: "load-state" | "network-idle" | "selector";
}

export type AssertionKind =
  | "visible"
  | "hidden"
  | "enabled"
  | "disabled"
  | "text"
  | "value"
  | "url"
  | "count"
  | "attribute"
  | "status";

export interface AssertStep extends ScenarioStepBase {
  action: "assert";
  assertion: AssertionKind;
  locator?: LocatorTarget;
  expected?: JsonValue;
  attribute?: string;
  comparator?: "equals" | "contains" | "matches" | "greater-than" | "less-than";
}

export interface ScreenshotStep extends ScenarioStepBase {
  action: "screenshot";
  name?: string;
  fullPage?: boolean;
  baselineKey?: string;
}

export interface EvaluateStep extends ScenarioStepBase {
  action: "evaluate";
  expression: string;
  risk: ActionRisk;
}

export type ScenarioStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | SelectOptionStep
  | CheckStep
  | UncheckStep
  | PressStep
  | WaitStep
  | AssertStep
  | ScreenshotStep
  | EvaluateStep;

export type ScenarioSource = "generated" | "user" | "discovered" | "imported";

/**
 * Phase 3 — a ScenarioProposal is the draft artifact an AI agent or discovery
 * produces before a scenario enters the executable catalog. Proposals must pass
 * `validateProposal` against the inventory before `importProposals` converts
 * them into `TestScenario` records. This gate keeps the catalog read-only-safe
 * and keeps every scenario traceable to an inventory page/route/role.
 */
export type ProposalStatus = "pending" | "accepted" | "rejected";
export type ProposalSource = "discovery" | "ai" | "manual" | "import";

export interface ProposalStep {
  action: string;
  target?: string;
  locator?: LocatorTarget;
  value?: string;
  url?: string;
  description?: string;
}

export type ProposalEvidenceType = "locator" | "route" | "role" | "screenshot" | "trace" | "observation";

export interface ProposalEvidence {
  type: ProposalEvidenceType;
  value: string;
}

export interface ScenarioProposal {
  id: string;
  schemaVersion: number;
  name: string;
  description?: string;
  source: ProposalSource;
  moduleId?: string;
  routeId?: string;
  pageId?: string;
  pageUrl?: string;
  roleIds: string[];
  tags: string[];
  risk: ActionRisk;
  expectedOutcome?: string;
  steps: ProposalStep[];
  evidence: ProposalEvidence[];
  createdAt: IsoDateTime;
  status: ProposalStatus;
  rejectionReason?: string;
}

export interface TestScenario {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  source: ScenarioSource;
  confidence: Confidence;
  moduleIds: string[];
  routeIds: string[];
  operationIds: string[];
  roleIds: string[];
  tags: string[];
  risk: ActionRisk;
  steps: ScenarioStep[];
  prerequisites?: string[];
  evidence: EvidenceRef[];
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
  metadata?: JsonObject;
}

export type RunScopeMode = "full" | "module" | "route" | "scenario" | "tag" | "role" | "affected" | "failed" | "smoke";

export interface RunScope {
  mode: RunScopeMode;
  moduleIds?: string[];
  routeIds?: string[];
  scenarioIds?: string[];
  tags?: string[];
  roleIds?: string[];
  changedPaths?: string[];
  failedRunId?: string;
  includeDependencies: boolean;
  excludedIds?: string[];
}

/** Backwards-readable name for callers that treat a run scope as a selector. */
export type ScopeFilter = RunScope;

export type BrowserName = "chromium" | "firefox" | "webkit";

export interface BrowserProfile {
  id: string;
  browser: BrowserName;
  headless: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  locale?: string;
  colorScheme?: "light" | "dark" | "no-preference";
  timezoneId?: string;
  userAgent?: string;
}

export interface RunPlanTarget {
  baseUrl: string;
  projectRoot: string;
  environment?: string;
}

export type TestLevel = "smoke" | "standard" | "regression" | "exploratory";
export type PlanStatus = "proposed" | "approved" | "running" | "completed" | "superseded";

export interface PlanApproval {
  approvedAt: IsoDateTime;
  approvedBy: string;
  inventoryDigest: string;
  /** Semantic digest of the exact scenario definitions selected by the plan. */
  scenarioDigest: string;
  policyDigest: string;
  /** Digest of the complete immutable plan content at approval time. */
  planDigest: string;
  note?: string;
}

export interface RunPlan {
  schemaVersion: 1;
  id: string;
  name: string;
  status: PlanStatus;
  projectId: string;
  inventoryId: string;
  inventoryDigest: string;
  /** Digest of the selected scenario definitions, including auto-included ones. */
  scenarioDigest: string;
  scope: RunScope;
  scenarioIds: string[];
  autoIncludedScenarioIds: string[];
  roles: string[];
  browserProfiles: BrowserProfile[];
  level: TestLevel;
  target: RunPlanTarget;
  policy: TestPolicy;
  createdAt: IsoDateTime;
  createdBy?: string;
  approval?: PlanApproval;
  digest: string;
  notes?: string[];
  metadata?: JsonObject;
}

export interface TestPolicy {
  maxRisk: ActionRisk;
  allowedHosts: string[];
  blockedHosts: string[];
  allowExternalOrigins: boolean;
  allowedActionNames: string[];
  blockedActionNames: string[];
  destructiveActionAllowlist: string[];
  allowSecretPersistence: boolean;
  allowTargetCodeChanges: boolean;
  requireTestDataNamespace: boolean;
  testDataNamespace?: string;
  allowProductionLikeHosts: boolean;
  productionLikeHostPatterns: string[];
  redactHeaders: string[];
  redactFields: string[];
  confirmationRequired: boolean;
}

export interface ArtifactRef {
  path: string;
  kind: "result" | "report" | "screenshot" | "trace" | "video" | "log" | "snapshot" | "other";
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
}

export type ScenarioRunStatus = "queued" | "running" | "passed" | "failed" | "blocked" | "skipped" | "error";

export interface AssertionResult {
  id: string;
  status: "passed" | "failed" | "skipped";
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  durationMs?: number;
}

export interface StepResult {
  stepId: string;
  action: ScenarioStep["action"];
  status: ScenarioRunStatus;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  durationMs?: number;
  error?: { name: string; message: string; stack?: string };
  assertions: AssertionResult[];
  artifacts: ArtifactRef[];
  metadata?: JsonObject;
}

export interface ScenarioResult {
  scenarioId: string;
  role: string;
  browserProfileId: string;
  status: ScenarioRunStatus;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  durationMs?: number;
  steps: StepResult[];
  findingIds: string[];
  artifacts: ArtifactRef[];
  error?: { name: string; message: string; stack?: string };
  metadata?: JsonObject;
}

export interface RunCoverage {
  routes: { selected: number; visited: number; passed: number };
  pages: { selected: number; rendered: number; failed: number };
  apis: { selected: number; observed: number; asserted: number };
  scenarios: { selected: number; executed: number; passed: number; failed: number; blocked: number };
  roles: { selected: number; exercised: number };
  browsers: { selected: number; exercised: number };
  unresolvedIds: string[];
}

export type RunStatus = "queued" | "running" | "passed" | "failed" | "blocked" | "cancelled" | "error";

export interface RunResult {
  schemaVersion: 1;
  id: string;
  planId: string;
  planDigest: string;
  inventoryId: string;
  inventoryDigest: string;
  status: RunStatus;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  durationMs?: number;
  scenarios: ScenarioResult[];
  findings: Finding[];
  coverage: RunCoverage;
  artifacts: ArtifactRef[];
  environment?: {
    baseUrl: string;
    browserProfiles: string[];
    gitCommit?: string;
    platform?: string;
  };
  metadata?: JsonObject;
}
