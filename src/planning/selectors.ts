import { relative, sep } from "node:path";

import type {
  Inventory,
  InventoryNode,
  ModuleInventoryNode,
  RunScope,
  TestScenario,
} from "../core/types.js";
import { computeDependencyClosure } from "./dependencies.js";
import type { ScenarioSelectionOptions, ScenarioSelectionResult } from "./types.js";

/** Select scenarios deterministically from one or more scope dimensions. */
export function selectScenarios(
  inventory: Inventory,
  scenarios: readonly TestScenario[],
  scope: RunScope,
  options: ScenarioSelectionOptions = {},
): ScenarioSelectionResult {
  const excluded = new Set(scope.excludedIds ?? []);
  const unmatchedSelectors: string[] = [];
  const affected = scope.mode === "affected" ? discoverAffectedDimensions(inventory, scope.changedPaths ?? []) : undefined;
  const failedIds = new Set(options.failedScenarioIds ?? []);

  let candidates = scenarios.filter((scenario) => {
    switch (scope.mode) {
      case "full":
        return true;
      case "module":
        return intersects(scenario.moduleIds, scope.moduleIds ?? []);
      case "route":
        return intersects(scenario.routeIds, scope.routeIds ?? []);
      case "scenario":
        return (scope.scenarioIds ?? []).includes(scenario.id);
      case "tag":
        return intersectsNormalized(scenario.tags, scope.tags ?? []);
      case "role":
        return intersects(scenario.roleIds, scope.roleIds ?? []);
      case "smoke":
        return scenario.tags.some((tag) => tag.toLowerCase() === "smoke");
      case "affected":
        return matchesAffectedScenario(scenario, affected);
      case "failed":
        return failedIds.has(scenario.id);
    }
  });

  // Non-primary selector arrays act as additional narrowing filters. This lets
  // callers request, for example, one module for one role and one tag.
  candidates = candidates.filter((scenario) => {
    if (scope.mode !== "module" && hasValues(scope.moduleIds) && !intersects(scenario.moduleIds, scope.moduleIds)) return false;
    if (scope.mode !== "route" && hasValues(scope.routeIds) && !intersects(scenario.routeIds, scope.routeIds)) return false;
    if (scope.mode !== "scenario" && hasValues(scope.scenarioIds) && !scope.scenarioIds.includes(scenario.id)) return false;
    if (scope.mode !== "tag" && hasValues(scope.tags) && !intersectsNormalized(scenario.tags, scope.tags)) return false;
    if (scope.mode !== "role" && hasValues(scope.roleIds) && !intersects(scenario.roleIds, scope.roleIds)) return false;
    return true;
  });

  collectUnmatchedSelectors(scenarios, inventory, scope, options, unmatchedSelectors);
  const excludedScenarioIds = scenarios.filter((scenario) => excluded.has(scenario.id)).map((scenario) => scenario.id);
  const explicitScenarioIds = candidates.filter((scenario) => !excluded.has(scenario.id)).map((scenario) => scenario.id);

  if (!scope.includeDependencies) {
    return {
      explicitScenarioIds,
      selectedScenarioIds: explicitScenarioIds,
      autoIncludedScenarioIds: [],
      excludedScenarioIds,
      unmatchedSelectors,
      missingDependencyIds: [],
      dependencyCycles: [],
      dependencyReasons: {},
    };
  }

  const closure = computeDependencyClosure(explicitScenarioIds, scenarios, inventory, [...excluded]);
  return {
    explicitScenarioIds,
    selectedScenarioIds: closure.scenarioIds,
    autoIncludedScenarioIds: closure.autoIncludedScenarioIds,
    excludedScenarioIds,
    unmatchedSelectors,
    missingDependencyIds: closure.missingDependencyIds,
    dependencyCycles: closure.dependencyCycles,
    dependencyReasons: closure.dependencyReasons,
  };
}

export function validateScope(scope: RunScope): string[] {
  const issues: string[] = [];
  switch (scope.mode) {
    case "module":
      if (!hasValues(scope.moduleIds)) issues.push("Module scope requires at least one module ID.");
      break;
    case "route":
      if (!hasValues(scope.routeIds)) issues.push("Route scope requires at least one route ID.");
      break;
    case "scenario":
      if (!hasValues(scope.scenarioIds)) issues.push("Scenario scope requires at least one scenario ID.");
      break;
    case "tag":
      if (!hasValues(scope.tags)) issues.push("Tag scope requires at least one tag.");
      break;
    case "role":
      if (!hasValues(scope.roleIds)) issues.push("Role scope requires at least one role ID.");
      break;
    case "affected":
      if (!hasValues(scope.changedPaths)) issues.push("Affected scope requires at least one changed path.");
      break;
    case "failed":
      if (scope.failedRunId === undefined || scope.failedRunId.trim().length === 0) {
        issues.push("Failed scope requires the referenced failed run ID.");
      }
      break;
    case "full":
    case "smoke":
      break;
  }
  return issues;
}

interface AffectedDimensions {
  moduleIds: Set<string>;
  routeIds: Set<string>;
  operationIds: Set<string>;
  sourcePaths: Set<string>;
}

function discoverAffectedDimensions(inventory: Inventory, changedPaths: readonly string[]): AffectedDimensions {
  const normalizedChanges = changedPaths.map(normalizePath);
  const result: AffectedDimensions = {
    moduleIds: new Set<string>(),
    routeIds: new Set<string>(),
    operationIds: new Set<string>(),
    sourcePaths: new Set(normalizedChanges),
  };

  for (const node of inventory.nodes) {
    if (!nodeMatchesChangedPath(node, normalizedChanges, inventory.project.rootDir)) continue;
    if (node.moduleId !== undefined) result.moduleIds.add(node.moduleId);
    if (node.kind === "module") result.moduleIds.add(node.id);
    if (node.kind === "route") result.routeIds.add(node.id);
    if (node.kind === "api") result.operationIds.add(node.id);
  }

  for (const node of inventory.nodes) {
    if (node.kind !== "module") continue;
    const module = node as ModuleInventoryNode;
    if (module.sourcePaths.some((sourcePath) => normalizedChanges.some((change) => pathsOverlap(sourcePath, change)))) {
      result.moduleIds.add(module.id);
      module.routeIds.forEach((id) => result.routeIds.add(id));
      module.apiIds.forEach((id) => result.operationIds.add(id));
    }
  }
  return result;
}

function matchesAffectedScenario(scenario: TestScenario, affected: AffectedDimensions | undefined): boolean {
  if (affected === undefined) return false;
  if (scenario.moduleIds.some((id) => affected.moduleIds.has(id))) return true;
  if (scenario.routeIds.some((id) => affected.routeIds.has(id))) return true;
  if (scenario.operationIds.some((id) => affected.operationIds.has(id))) return true;
  const metadataPaths = scenario.metadata?.sourcePaths;
  if (Array.isArray(metadataPaths)) {
    return metadataPaths.some((path) => typeof path === "string" && [...affected.sourcePaths].some((change) => pathsOverlap(path, change)));
  }
  return false;
}

function nodeMatchesChangedPath(node: InventoryNode, changedPaths: string[], rootDir: string): boolean {
  const sourcePaths: string[] = [];
  for (const evidence of node.evidence) {
    if (evidence.source?.filePath !== undefined) sourcePaths.push(evidence.source.filePath);
  }
  if (node.kind === "route" && node.entryFile !== undefined) sourcePaths.push(node.entryFile);
  if (node.kind === "page" && node.entryFile !== undefined) sourcePaths.push(node.entryFile);
  if (node.kind === "component" && node.sourceFile !== undefined) sourcePaths.push(node.sourceFile);
  if (node.kind === "api" && node.sourceFile !== undefined) sourcePaths.push(node.sourceFile);
  if (node.kind === "store" && node.sourceFile !== undefined) sourcePaths.push(node.sourceFile);
  if (node.kind === "guard" && node.sourceFile !== undefined) sourcePaths.push(node.sourceFile);
  if (node.kind === "test" && node.sourceFile !== undefined) sourcePaths.push(node.sourceFile);
  return sourcePaths.some((sourcePath) => {
    const relativePath = normalizePath(relative(rootDir, sourcePath));
    return changedPaths.some((change) => pathsOverlap(sourcePath, change) || pathsOverlap(relativePath, change));
  });
}

function collectUnmatchedSelectors(
  scenarios: readonly TestScenario[],
  inventory: Inventory,
  scope: RunScope,
  options: ScenarioSelectionOptions,
  output: string[],
): void {
  const dimensions: Array<[string, readonly string[] | undefined, Set<string>]> = [
    ["module", scope.moduleIds, new Set(inventory.nodes.filter((node) => node.kind === "module").map((node) => node.id))],
    ["route", scope.routeIds, new Set(inventory.nodes.filter((node) => node.kind === "route").map((node) => node.id))],
    ["scenario", scope.scenarioIds, new Set(scenarios.map((scenario) => scenario.id))],
    ["role", scope.roleIds, new Set(inventory.nodes.filter((node) => node.kind === "role").map((node) => node.id))],
  ];
  const knownTags = new Set(scenarios.flatMap((scenario) => scenario.tags.map((tag) => tag.toLowerCase())));
  for (const [label, values, known] of dimensions) {
    for (const value of values ?? []) {
      if (!known.has(value)) output.push(`${label}:${value}`);
    }
  }
  for (const tag of scope.tags ?? []) {
    if (!knownTags.has(tag.toLowerCase())) output.push(`tag:${tag}`);
  }
  if (scope.mode === "failed" && (options.failedScenarioIds?.length ?? 0) === 0) {
    output.push(`failed-run:${scope.failedRunId ?? "unknown"}`);
  }
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const wanted = new Set(right);
  return left.some((item) => wanted.has(item));
}

function intersectsNormalized(left: readonly string[], right: readonly string[]): boolean {
  const wanted = new Set(right.map((item) => item.toLowerCase()));
  return left.some((item) => wanted.has(item.toLowerCase()));
}

function hasValues(values: readonly string[] | undefined): values is readonly string[] {
  return values !== undefined && values.length > 0;
}

function normalizePath(value: string): string {
  return value.split(sep).join("/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`);
}
