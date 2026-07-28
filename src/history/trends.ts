import { readdir } from 'node:fs/promises';

import type { ArtifactStore } from '../core/artifacts.js';
import type { RunResult } from '../core/types.js';
import { classifyRunFailures } from '../healing/classifier.js';
import type { FailureCategory } from '../healing/types.js';

/** One run reduced to trend-relevant numbers. */
export interface RunTrendPoint {
  runId: string;
  planId: string;
  status: RunResult['status'];
  startedAt: string;
  durationMs?: number | undefined;
  scenarios: { executed: number; passed: number; failed: number; blocked: number };
  passRate: number;
  coverage: {
    routesVisited: number;
    routesSelected: number;
    apisObserved: number;
    apisSelected: number;
  };
  failureCategories: Partial<Record<FailureCategory, number>>;
}

export interface TrendReport {
  points: RunTrendPoint[];
  /** Comparison of the newest point against the previous one (if any). */
  delta?: {
    passRate: number;
    routesVisited: number;
    apisObserved: number;
    newFailureCategories: FailureCategory[];
    resolvedFailureCategories: FailureCategory[];
  } | undefined;
  /** Scenario ids that failed in each of the last `flakyWindow` runs at least once but not always. */
  flakyScenarioIds: string[];
}

/** Reduce a RunResult to a single trend point. */
export function toTrendPoint(result: RunResult): RunTrendPoint {
  const { scenarios: scenarioCoverage, routes, apis } = result.coverage;
  const executed = scenarioCoverage.executed;
  const failureCategories: Partial<Record<FailureCategory, number>> = {};
  for (const classification of classifyRunFailures(result.scenarios)) {
    failureCategories[classification.category] = (failureCategories[classification.category] ?? 0) + 1;
  }
  return {
    runId: result.id,
    planId: result.planId,
    status: result.status,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    scenarios: {
      executed,
      passed: scenarioCoverage.passed,
      failed: scenarioCoverage.failed,
      blocked: scenarioCoverage.blocked,
    },
    passRate: executed > 0 ? scenarioCoverage.passed / executed : 0,
    coverage: {
      routesVisited: routes.visited,
      routesSelected: routes.selected,
      apisObserved: apis.observed,
      apisSelected: apis.selected,
    },
    failureCategories,
  };
}

/**
 * Build a trend report over a list of run results (any order; sorted by
 * startedAt internally). Pure — callers load the RunResults themselves or
 * use `loadTrendReport` below.
 */
export function buildTrendReport(results: RunResult[], options: { flakyWindow?: number } = {}): TrendReport {
  const points = results
    .map(toTrendPoint)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));

  let delta: TrendReport['delta'];
  if (points.length >= 2) {
    const latest = points[points.length - 1]!;
    const previous = points[points.length - 2]!;
    const latestCategories = new Set(Object.keys(latest.failureCategories) as FailureCategory[]);
    const previousCategories = new Set(Object.keys(previous.failureCategories) as FailureCategory[]);
    delta = {
      passRate: latest.passRate - previous.passRate,
      routesVisited: latest.coverage.routesVisited - previous.coverage.routesVisited,
      apisObserved: latest.coverage.apisObserved - previous.coverage.apisObserved,
      newFailureCategories: [...latestCategories].filter((category) => !previousCategories.has(category)),
      resolvedFailureCategories: [...previousCategories].filter((category) => !latestCategories.has(category)),
    };
  }

  return {
    points,
    delta,
    flakyScenarioIds: findFlakyScenarios(results, options.flakyWindow ?? 5),
  };
}

/**
 * A scenario is flaky when, within the observation window, it both passed and
 * failed across runs (same scenario id, mixed outcomes).
 */
export function findFlakyScenarios(results: RunResult[], window: number): string[] {
  const recent = [...results]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(-window);
  const outcomes = new Map<string, { passed: boolean; failed: boolean }>();
  for (const run of recent) {
    for (const scenario of run.scenarios) {
      const entry = outcomes.get(scenario.scenarioId) ?? { passed: false, failed: false };
      if (scenario.status === 'passed') entry.passed = true;
      if (scenario.status === 'failed' || scenario.status === 'error' || scenario.status === 'blocked') entry.failed = true;
      outcomes.set(scenario.scenarioId, entry);
    }
  }
  return [...outcomes.entries()]
    .filter(([, entry]) => entry.passed && entry.failed)
    .map(([scenarioId]) => scenarioId)
    .sort();
}

/** Load all persisted runs from the artifact store and build the report. */
export async function loadTrendReport(store: ArtifactStore, options: { flakyWindow?: number } = {}): Promise<TrendReport> {
  const results: RunResult[] = [];
  let runIds: string[] = [];
  try {
    runIds = await readdir(store.layout.runs);
  } catch {
    return { points: [], flakyScenarioIds: [] };
  }
  for (const runId of runIds) {
    try {
      results.push(await store.readRunResult(runId));
    } catch {
      // Runs without a result.json (interrupted) are skipped from trends.
    }
  }
  return buildTrendReport(results, options);
}
