import type {
  BrowserProfile,
  Inventory,
  RunPlan,
  RunPlanTarget,
  RunScope,
  TestLevel,
  TestPolicy,
  TestScenario,
} from "../core/types.js";

export interface ScenarioSelectionOptions {
  /** Scenario IDs from a referenced failed run (used by `failed` scope). */
  failedScenarioIds?: string[];
}

export interface ScenarioSelectionResult {
  explicitScenarioIds: string[];
  selectedScenarioIds: string[];
  autoIncludedScenarioIds: string[];
  excludedScenarioIds: string[];
  unmatchedSelectors: string[];
  missingDependencyIds: string[];
  dependencyCycles: string[][];
  dependencyReasons: Record<string, string[]>;
}

export interface DependencyClosureResult {
  scenarioIds: string[];
  autoIncludedScenarioIds: string[];
  missingDependencyIds: string[];
  dependencyCycles: string[][];
  dependencyReasons: Record<string, string[]>;
}

export interface ProposePlanInput {
  inventory: Inventory;
  scenarios: TestScenario[];
  scope: RunScope;
  target: RunPlanTarget;
  policy: TestPolicy;
  browserProfiles?: BrowserProfile[];
  roles?: string[];
  level?: TestLevel;
  name?: string;
  createdBy?: string;
  now?: Date | string;
  selection?: ScenarioSelectionOptions;
}

export interface ProposedPlanResult {
  plan: RunPlan;
  selection: ScenarioSelectionResult;
  validation: PlanValidationResult;
}

export type PlanValidationSeverity = "error" | "warning";

export interface PlanValidationIssue {
  code:
    | "status"
    | "digest"
    | "inventory"
    | "scope"
    | "empty-selection"
    | "unknown-scenario"
    | "excluded-scenario"
    | "missing-dependency"
    | "dependency-cycle"
    | "role"
    | "browser-profile"
    | "policy"
    | "test-data"
    | "approval";
  severity: PlanValidationSeverity;
  message: string;
  relatedIds?: string[];
}

export interface PlanValidationResult {
  valid: boolean;
  issues: PlanValidationIssue[];
}

export interface PlanValidationContext {
  inventory: Inventory;
  scenarios: TestScenario[];
  selection?: ScenarioSelectionResult;
}

export interface ApprovePlanInput {
  approvedBy: string;
  approvedAt?: Date | string;
  note?: string;
}
