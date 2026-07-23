import { stableId } from "../core/ids.js";
import type { BrowserProfile, RunPlan, TestScenario } from "../core/types.js";
import { computeInventoryDigest, computePlanDigest, computeScenarioDigest, validatePlan } from "./approval.js";
import { selectScenarios } from "./selectors.js";
import type { ProposedPlanResult, ProposePlanInput } from "./types.js";

export function proposePlan(input: ProposePlanInput): ProposedPlanResult {
  const now = toIsoDate(input.now ?? new Date());
  const selection = selectScenarios(input.inventory, input.scenarios, input.scope, input.selection);
  const browserProfiles = input.browserProfiles === undefined ? [defaultBrowserProfile()] : input.browserProfiles;
  const roles = input.roles === undefined ? inferRoles(input.scenarios, selection.selectedScenarioIds) : unique(input.roles);
  const level = input.level ?? (input.scope.mode === "smoke" ? "smoke" : "regression");
  const planId = stableId("plan", input.inventory.id, input.scope, selection.selectedScenarioIds, now);
  const planWithoutDigest: RunPlan = {
    schemaVersion: 1,
    id: planId,
    name: input.name?.trim() || defaultPlanName(input.scope, selection.selectedScenarioIds.length),
    status: "proposed",
    projectId: input.inventory.project.id,
    inventoryId: input.inventory.id,
    inventoryDigest: computeInventoryDigest(input.inventory),
    scenarioDigest: computeScenarioDigest(input.scenarios, selection.selectedScenarioIds),
    scope: cloneScope(input.scope),
    scenarioIds: [...selection.selectedScenarioIds],
    autoIncludedScenarioIds: [...selection.autoIncludedScenarioIds],
    roles,
    browserProfiles: browserProfiles.map((profile) => ({ ...profile, viewport: { ...profile.viewport } })),
    level,
    target: { ...input.target },
    policy: clonePolicy(input.policy),
    createdAt: now,
    ...(input.createdBy === undefined || input.createdBy.trim().length === 0 ? {} : { createdBy: input.createdBy.trim() }),
    notes: buildPlanNotes(selection),
    digest: "pending",
  };
  const plan: RunPlan = { ...planWithoutDigest, digest: "" };
  plan.digest = computePlanDigest(plan);
  const validation = validatePlan(plan, { inventory: input.inventory, scenarios: input.scenarios, selection });
  return { plan, selection, validation };
}

/** Alias kept intentionally descriptive for CLI and AI-agent callers. */
export const createProposedPlan = proposePlan;

function inferRoles(scenarios: readonly TestScenario[], selectedIds: readonly string[]): string[] {
  const selected = new Set(selectedIds);
  return unique(scenarios.filter((scenario) => selected.has(scenario.id)).flatMap((scenario) => scenario.roleIds));
}

function defaultBrowserProfile(): BrowserProfile {
  return {
    id: "chromium-desktop",
    browser: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
  };
}

function defaultPlanName(scope: ProposePlanInput["scope"], count: number): string {
  const label = scope.mode === "full" ? "full" : `${scope.mode} scope`;
  return `${label} test plan (${count} scenario${count === 1 ? "" : "s"})`;
}

function buildPlanNotes(selection: ProposedPlanResult["selection"]): string[] {
  const notes: string[] = [];
  if (selection.autoIncludedScenarioIds.length > 0) {
    notes.push(`Automatically included ${selection.autoIncludedScenarioIds.length} prerequisite scenario(s).`);
  }
  if (selection.unmatchedSelectors.length > 0) {
    notes.push(`Unmatched selectors: ${selection.unmatchedSelectors.join(", ")}.`);
  }
  if (selection.missingDependencyIds.length > 0) {
    notes.push(`Missing dependencies: ${selection.missingDependencyIds.join(", ")}.`);
  }
  if (selection.dependencyCycles.length > 0) {
    notes.push(`Dependency cycles detected: ${selection.dependencyCycles.map((cycle) => cycle.join(" → ")).join("; ")}.`);
  }
  return notes;
}

function cloneScope(scope: ProposePlanInput["scope"]): ProposePlanInput["scope"] {
  return {
    mode: scope.mode,
    includeDependencies: scope.includeDependencies,
    ...(scope.moduleIds === undefined ? {} : { moduleIds: [...scope.moduleIds] }),
    ...(scope.routeIds === undefined ? {} : { routeIds: [...scope.routeIds] }),
    ...(scope.scenarioIds === undefined ? {} : { scenarioIds: [...scope.scenarioIds] }),
    ...(scope.tags === undefined ? {} : { tags: [...scope.tags] }),
    ...(scope.roleIds === undefined ? {} : { roleIds: [...scope.roleIds] }),
    ...(scope.changedPaths === undefined ? {} : { changedPaths: [...scope.changedPaths] }),
    ...(scope.failedRunId === undefined ? {} : { failedRunId: scope.failedRunId }),
    ...(scope.excludedIds === undefined ? {} : { excludedIds: [...scope.excludedIds] }),
  };
}

function clonePolicy(policy: ProposePlanInput["policy"]): ProposePlanInput["policy"] {
  return {
    ...policy,
    allowedHosts: [...policy.allowedHosts],
    blockedHosts: [...policy.blockedHosts],
    allowedActionNames: [...policy.allowedActionNames],
    blockedActionNames: [...policy.blockedActionNames],
    destructiveActionAllowlist: [...policy.destructiveActionAllowlist],
    productionLikeHostPatterns: [...policy.productionLikeHostPatterns],
    redactHeaders: [...policy.redactHeaders],
    redactFields: [...policy.redactFields],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function toIsoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("Plan timestamp must be a valid date.");
  return date.toISOString();
}
