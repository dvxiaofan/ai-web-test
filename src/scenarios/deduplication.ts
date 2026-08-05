import { stableStringify } from "../core/ids.js";
import type { LocatorTarget, ScenarioProposal, TestScenario } from "../core/types.js";

/**
 * Phase 3 — duplicate detection for scenarios and proposals.
 *
 * Two scenarios are considered duplicates when they target the same page/route,
 * the same roles, and perform the same ordered steps. The signature intentionally
 * ignores cosmetic fields (name, description, tags) and authorship so that a
 * re-discovered or re-proposed scenario is detected even with a different title.
 */

/** Structural subset shared by ProposalStep and ScenarioStep — all scenarioSignature needs. */
interface SignatureStep {
  action: string;
  locator?: LocatorTarget;
  url?: string;
  value?: string | string[];
}

export interface ScenarioSignatureInput {
  routeId: string | undefined;
  roleIds: string[];
  steps: ReadonlyArray<SignatureStep>;
}

export interface DuplicateGroup<T> {
  signature: string;
  items: T[];
}

export function scenarioSignature(input: ScenarioSignatureInput): string {
  const canonical = {
    routeId: input.routeId ?? "",
    roleIds: [...input.roleIds].filter(Boolean).sort(),
    steps: input.steps.map((step) => ({
      action: step.action,
      locator: step.locator
        ? { strategy: step.locator.strategy, value: step.locator.value, name: step.locator.name ?? "" }
        : null,
      url: step.url ?? "",
      value: step.value ?? "",
    })),
  };
  return stableStringify(canonical);
}

function groupBySignature<T>(items: readonly T[], toSignature: (item: T) => string): DuplicateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const signature = toSignature(item);
    const bucket = buckets.get(signature);
    if (bucket) bucket.push(item);
    else buckets.set(signature, [item]);
  }
  return [...buckets.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([signature, items]) => ({ signature, items }));
}

export function findDuplicateScenarios(scenarios: readonly TestScenario[]): DuplicateGroup<TestScenario>[] {
  return groupBySignature(scenarios, (scenario) =>
    scenarioSignature({
      routeId: scenario.routeIds[0],
      roleIds: scenario.roleIds,
      steps: scenario.steps,
    }),
  );
}

export function findDuplicateProposals(proposals: readonly ScenarioProposal[]): DuplicateGroup<ScenarioProposal>[] {
  return groupBySignature(proposals, (proposal) =>
    scenarioSignature({
      routeId: proposal.routeId,
      roleIds: proposal.roleIds,
      steps: proposal.steps,
    }),
  );
}
