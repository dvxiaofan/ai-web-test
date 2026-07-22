import { contentDigest, stableStringify } from "../core/ids.js";
import { evaluatePolicy, isProductionLikeHostname } from "../core/policy.js";
import type { Inventory, PlanApproval, RunPlan, TestScenario } from "../core/types.js";
import { validateScope } from "./selectors.js";
import type {
  ApprovePlanInput,
  PlanValidationContext,
  PlanValidationIssue,
  PlanValidationResult,
  ScenarioSelectionResult,
} from "./types.js";

/** Return the digest of the policy that is bound into an approval. */
export function computePolicyDigest(planOrPolicy: RunPlan["policy"]): string {
  return contentDigest(planOrPolicy);
}

/** Compute the immutable content digest of a proposed/approved plan. */
export function computePlanDigest(plan: RunPlan): string {
  const content = {
    schemaVersion: plan.schemaVersion,
    id: plan.id,
    name: plan.name,
    projectId: plan.projectId,
    inventoryId: plan.inventoryId,
    inventoryDigest: plan.inventoryDigest,
    scope: plan.scope,
    scenarioIds: plan.scenarioIds,
    autoIncludedScenarioIds: plan.autoIncludedScenarioIds,
    roles: plan.roles,
    browserProfiles: plan.browserProfiles,
    level: plan.level,
    target: plan.target,
    policy: plan.policy,
    ...(plan.createdBy === undefined ? {} : { createdBy: plan.createdBy }),
    ...(plan.notes === undefined ? {} : { notes: plan.notes }),
    ...(plan.metadata === undefined ? {} : { metadata: plan.metadata }),
  };
  return contentDigest(content);
}

/** Validate a plan before the operator is offered the approval prompt. */
export function validatePlan(plan: RunPlan, context: PlanValidationContext): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  const scenarioById = new Map(context.scenarios.map((scenario) => [scenario.id, scenario]));
  const selected = new Set(plan.scenarioIds);
  const selection = context.selection;

  if (plan.status !== "proposed" && plan.status !== "approved") {
    issues.push({ code: "status", severity: "error", message: `Plan status ${plan.status} cannot be approved or validated for execution.` });
  }
  if (plan.inventoryId !== context.inventory.id) {
    issues.push({ code: "inventory", severity: "error", message: "Plan references a different inventory.", relatedIds: [plan.inventoryId, context.inventory.id] });
  }
  const actualInventoryDigest = contentDigest(context.inventory);
  if (plan.inventoryDigest !== actualInventoryDigest) {
    issues.push({ code: "digest", severity: "error", message: "Inventory changed after this plan was generated." });
  }
  if (plan.digest !== computePlanDigest(plan)) {
    issues.push({ code: "digest", severity: "error", message: "Plan digest does not match its immutable contents." });
  }

  for (const message of validateScope(plan.scope)) {
    issues.push({ code: "scope", severity: "error", message });
  }
  if (plan.scenarioIds.length === 0) {
    issues.push({ code: "empty-selection", severity: "error", message: "The selected scope contains no executable scenarios." });
  }
  for (const scenarioId of plan.scenarioIds) {
    if (!scenarioById.has(scenarioId)) {
      issues.push({ code: "unknown-scenario", severity: "error", message: `Scenario ${scenarioId} is not present in the scenario catalog.`, relatedIds: [scenarioId] });
    }
  }
  for (const scenarioId of plan.autoIncludedScenarioIds) {
    if (!selected.has(scenarioId)) {
      issues.push({ code: "unknown-scenario", severity: "error", message: `Auto-included scenario ${scenarioId} is not in the selected scenario list.`, relatedIds: [scenarioId] });
    }
  }
  if (selection !== undefined) {
    for (const id of selection.missingDependencyIds) {
      issues.push({ code: "missing-dependency", severity: "error", message: `Dependency ${id} could not be included.`, relatedIds: [id] });
    }
    for (const cycle of selection.dependencyCycles) {
      issues.push({ code: "dependency-cycle", severity: "error", message: `Scenario dependency cycle: ${cycle.join(" → ")}.`, relatedIds: cycle });
    }
    for (const id of selection.excludedScenarioIds) {
      if (selected.has(id)) {
        issues.push({ code: "excluded-scenario", severity: "error", message: `Scenario ${id} is explicitly excluded but selected.`, relatedIds: [id] });
      }
    }
    for (const selector of selection.unmatchedSelectors) {
      issues.push({ code: "scope", severity: "warning", message: `Selector did not match discovered inventory: ${selector}.` });
    }
  }

  if (plan.browserProfiles.length === 0) {
    issues.push({ code: "browser-profile", severity: "error", message: "At least one browser profile is required." });
  }
  const roleSet = new Set(plan.roles);
  if (plan.roles.length === 0 && context.scenarios.some((scenario) => plan.scenarioIds.includes(scenario.id) && scenario.roleIds.length > 0)) {
    issues.push({ code: "role", severity: "error", message: "Selected scenarios require at least one configured role." });
  }

  validateTargetAndPolicy(plan, issues);
  for (const scenarioId of plan.scenarioIds) {
    const scenario = scenarioById.get(scenarioId);
    if (scenario === undefined) continue;
    if (scenario.roleIds.length > 0 && plan.roles.length > 0 && !scenario.roleIds.some((role) => roleSet.has(role))) {
      issues.push({ code: "role", severity: "error", message: `No selected role can execute scenario ${scenario.name}.`, relatedIds: [scenario.id] });
    }
    validateScenarioPolicy(plan, scenario, issues);
  }
  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

/** Validate and attach an explicit operator approval to a proposed plan. */
export function approvePlan(
  plan: RunPlan,
  input: ApprovePlanInput,
  context: PlanValidationContext,
): RunPlan {
  if (plan.status !== "proposed") {
    throw new PlanApprovalError("Only a proposed plan can be approved.", [{ code: "status", severity: "error", message: `Plan status is ${plan.status}.` }]);
  }
  const validation = validatePlan(plan, context);
  if (!validation.valid) {
    throw new PlanApprovalError("Plan failed approval validation.", validation.issues);
  }
  const approvedBy = input.approvedBy.trim();
  if (approvedBy.length === 0) {
    throw new PlanApprovalError("An approving operator identity is required.", [{ code: "approval", severity: "error", message: "approvedBy cannot be empty." }]);
  }
  const approvedAt = toIsoDate(input.approvedAt ?? new Date());
  const approval: PlanApproval = {
    approvedAt,
    approvedBy,
    inventoryDigest: plan.inventoryDigest,
    policyDigest: computePolicyDigest(plan.policy),
    ...(input.note === undefined || input.note.trim().length === 0 ? {} : { note: input.note.trim() }),
  };
  return { ...plan, status: "approved", approval };
}

/** Validate an immutable approved plan immediately before execution. */
export function validateApprovedPlan(plan: RunPlan, context: PlanValidationContext): PlanValidationResult {
  const base = validatePlan(plan, context);
  const issues = [...base.issues];
  if (plan.status !== "approved") {
    issues.push({ code: "approval", severity: "error", message: "The run plan has not been approved by an operator." });
  }
  const approval = plan.approval;
  if (approval === undefined) {
    issues.push({ code: "approval", severity: "error", message: "Approved plans must contain an approval record." });
  } else {
    if (approval.inventoryDigest !== plan.inventoryDigest) {
      issues.push({ code: "approval", severity: "error", message: "Approval is bound to a different inventory digest." });
    }
    if (approval.policyDigest !== computePolicyDigest(plan.policy)) {
      issues.push({ code: "approval", severity: "error", message: "Policy changed after operator approval." });
    }
    if (approval.approvedBy.trim().length === 0) {
      issues.push({ code: "approval", severity: "error", message: "Approval identity is empty." });
    }
    if (!isValidDate(approval.approvedAt)) {
      issues.push({ code: "approval", severity: "error", message: "Approval timestamp is invalid." });
    }
  }
  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

export function assertApprovedPlan(plan: RunPlan, context: PlanValidationContext): void {
  const validation = validateApprovedPlan(plan, context);
  if (!validation.valid) {
    throw new PlanApprovalError("Approved plan validation failed.", validation.issues);
  }
}

export class PlanApprovalError extends Error {
  readonly issues: PlanValidationIssue[];

  constructor(message: string, issues: PlanValidationIssue[]) {
    super(message);
    this.name = "PlanApprovalError";
    this.issues = issues;
  }
}

function validateTargetAndPolicy(plan: RunPlan, issues: PlanValidationIssue[]): void {
  let targetUrl: URL;
  try {
    targetUrl = new URL(plan.target.baseUrl);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      issues.push({ code: "policy", severity: "error", message: "Target base URL must use HTTP or HTTPS." });
      return;
    }
  } catch {
    issues.push({ code: "policy", severity: "error", message: "Target base URL is invalid." });
    return;
  }
  if (isProductionLikeHostname(targetUrl.hostname, plan.policy.productionLikeHostPatterns) && !plan.policy.allowProductionLikeHosts) {
    issues.push({ code: "policy", severity: "error", message: `Target host ${targetUrl.hostname} looks production-like and is not allowed.` });
  }
  const decision = evaluatePolicy(plan.policy, { name: "plan-target-navigation", risk: "read", url: targetUrl.href }, targetUrl.href);
  if (!decision.allowed) {
    issues.push({ code: "policy", severity: "error", message: decision.reason });
  }
}

function validateScenarioPolicy(plan: RunPlan, scenario: TestScenario, issues: PlanValidationIssue[]): void {
  const scenarioDecision = evaluatePolicy(plan.policy, { name: scenario.id, risk: scenario.risk }, plan.target.baseUrl);
  if (!scenarioDecision.allowed) {
    issues.push({ code: "policy", severity: "error", message: `Scenario ${scenario.name}: ${scenarioDecision.reason}`, relatedIds: [scenario.id] });
  }
  if (scenario.risk !== "read" && plan.policy.requireTestDataNamespace && (plan.policy.testDataNamespace?.trim().length ?? 0) === 0) {
    issues.push({ code: "test-data", severity: "error", message: `Scenario ${scenario.name} can mutate data but no test-data namespace is configured.`, relatedIds: [scenario.id] });
  }
  for (const step of scenario.steps) {
    const actionName = step.name?.trim() || step.id;
    const decision = evaluatePolicy(plan.policy, { name: actionName, risk: step.risk }, plan.target.baseUrl);
    if (!decision.allowed) {
      issues.push({ code: "policy", severity: "error", message: `Step ${actionName}: ${decision.reason}`, relatedIds: [scenario.id, step.id] });
    }
  }
}

function toIsoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("Approval timestamp must be a valid date.");
  return date.toISOString();
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).valueOf());
}

// Keep this import used by consumers that need to inspect canonical contents
// while avoiding accidental JSON.stringify ordering differences in callers.
export function canonicalPlanJson(plan: RunPlan): string {
  return stableStringify(plan);
}
