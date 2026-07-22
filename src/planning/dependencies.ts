import type { Inventory, ScenarioInventoryNode, TestScenario } from "../core/types.js";
import type { DependencyClosureResult } from "./types.js";

/** Resolve explicit scenario prerequisites and inventory graph dependencies. */
export function computeDependencyClosure(
  selectedScenarioIds: readonly string[],
  scenarios: readonly TestScenario[],
  inventory?: Inventory,
  excludedScenarioIds: readonly string[] = [],
): DependencyClosureResult {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const excluded = new Set(excludedScenarioIds);
  const dependencyMap = buildDependencyMap(scenarios, inventory);
  const explicit = uniqueKnownIds(selectedScenarioIds, scenarioById);
  const explicitSet = new Set(explicit);
  const included = new Set<string>();
  const missing = new Set<string>();
  const reasons = new Map<string, Set<string>>();
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();
  const visiting: string[] = [];
  const visited = new Set<string>();
  const ordered: string[] = [];

  const visit = (scenarioId: string): void => {
    if (excluded.has(scenarioId)) {
      missing.add(scenarioId);
      return;
    }
    if (!scenarioById.has(scenarioId)) {
      missing.add(scenarioId);
      return;
    }
    const cycleIndex = visiting.indexOf(scenarioId);
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), scenarioId];
      const key = canonicalCycleKey(cycle);
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        cycles.push(cycle);
      }
      return;
    }
    if (visited.has(scenarioId)) return;

    visiting.push(scenarioId);
    for (const dependency of dependencyMap.get(scenarioId) ?? []) {
      addReason(reasons, dependency.id, dependency.reason);
      visit(dependency.id);
    }
    visiting.pop();
    visited.add(scenarioId);
    included.add(scenarioId);
    ordered.push(scenarioId);
  };

  for (const scenarioId of explicit) visit(scenarioId);

  return {
    scenarioIds: ordered,
    autoIncludedScenarioIds: ordered.filter((id) => !explicitSet.has(id)),
    missingDependencyIds: [...missing].sort(),
    dependencyCycles: cycles,
    dependencyReasons: Object.fromEntries(
      [...reasons.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, values]) => [id, [...values].sort()]),
    ),
  };
}

interface DependencyRef {
  id: string;
  reason: string;
}

function buildDependencyMap(scenarios: readonly TestScenario[], inventory?: Inventory): Map<string, DependencyRef[]> {
  const map = new Map<string, DependencyRef[]>();
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  for (const scenario of scenarios) {
    for (const prerequisite of scenario.prerequisites ?? []) {
      addDependency(map, scenario.id, prerequisite, `declared prerequisite of ${scenario.id}`);
    }
  }

  if (inventory === undefined) return map;
  const nodeToScenario = new Map<string, string>();
  for (const node of inventory.nodes) {
    if (node.kind !== "scenario") continue;
    const scenarioNode = node as ScenarioInventoryNode;
    if (scenarioIds.has(scenarioNode.scenarioId)) {
      nodeToScenario.set(node.id, scenarioNode.scenarioId);
      nodeToScenario.set(scenarioNode.scenarioId, scenarioNode.scenarioId);
    }
  }

  for (const edge of inventory.edges) {
    const from = nodeToScenario.get(edge.from);
    const to = nodeToScenario.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (edge.relationship === "depends-on") {
      addDependency(map, from, to, `inventory dependency ${edge.id}`);
    } else if (edge.relationship === "prepares") {
      addDependency(map, to, from, `inventory preparation ${edge.id}`);
    }
  }
  return map;
}

function addDependency(map: Map<string, DependencyRef[]>, owner: string, dependency: string, reason: string): void {
  const current = map.get(owner) ?? [];
  if (!current.some((entry) => entry.id === dependency && entry.reason === reason)) {
    current.push({ id: dependency, reason });
    current.sort((left, right) => left.id.localeCompare(right.id));
    map.set(owner, current);
  }
}

function addReason(reasons: Map<string, Set<string>>, id: string, reason: string): void {
  const values = reasons.get(id) ?? new Set<string>();
  values.add(reason);
  reasons.set(id, values);
}

function uniqueKnownIds(ids: readonly string[], scenarios: ReadonlyMap<string, TestScenario>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!scenarios.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function canonicalCycleKey(cycle: string[]): string {
  const body = cycle.slice(0, -1);
  if (body.length === 0) return "";
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join("\u0000"));
  return rotations.sort()[0] ?? "";
}
