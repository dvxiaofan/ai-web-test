import type {
  ActionRisk,
  AssertionKind,
  Inventory,
  JsonValue,
  ProposalSource,
  ScenarioProposal,
  ScenarioSource,
  ScenarioStep,
  TestScenario,
} from "../core/types.js";
import { stableId } from "../core/ids.js";
import { validateScenario } from "./io.js";
import { scenarioSignature } from "./deduplication.js";
import { validateProposal } from "./validator.js";

/**
 * Phase 3 — proposal importer.
 *
 * `importProposals` is the gate between the draft proposal pool and the
 * executable `TestScenario` catalog. Every proposal is re-validated against the
 * inventory (route/page/module/role references, duplicate detection) and then
 * lowered into a strongly-typed `TestScenario`. The resulting scenario id is
 * content-addressed, so re-importing the same proposal idempotently merges
 * rather than duplicating.
 */

export interface ImportOptions {
  existingScenarios?: readonly TestScenario[];
  /** Default confidence when the proposal does not carry one. */
  confidence?: number;
}

export interface ImportResult {
  scenarios: TestScenario[];
  rejected: Array<{ proposal: ScenarioProposal; reason: string }>;
}

const SOURCE_MAP: Record<ProposalSource, ScenarioSource> = {
  discovery: "discovered",
  ai: "generated",
  manual: "user",
  import: "imported",
};

export function importProposals(
  proposals: readonly ScenarioProposal[],
  inventory: Inventory,
  options: ImportOptions = {},
): ImportResult {
  const scenarios: TestScenario[] = [];
  const rejected: ImportResult["rejected"] = [];
  const existing = options.existingScenarios ?? [];

  // Pre-deduplicate the batch by signature, keeping the first occurrence, so
  // re-proposed or duplicated drafts do not enter the catalog twice.
  const seen = new Set<string>();
  const unique: ScenarioProposal[] = [];
  for (const proposal of proposals) {
    const signature = scenarioSignature({
      routeId: proposal.routeId,
      roleIds: proposal.roleIds,
      steps: proposal.steps,
    });
    if (seen.has(signature)) {
      rejected.push({ proposal, reason: `Proposal duplicates sibling proposal '${proposal.id}'.` });
      continue;
    }
    seen.add(signature);
    unique.push(proposal);
  }

  for (const proposal of unique) {
    const validation = validateProposal(proposal, { inventory, existingScenarios: existing });
    if (validation.status !== "accepted") {
      rejected.push({ proposal, reason: validation.errors.join("; ") });
      continue;
    }

    try {
      scenarios.push(toScenario(proposal, options.confidence ?? defaultConfidence(proposal.source)));
    } catch (error) {
      rejected.push({ proposal, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { scenarios, rejected };
}

/** Merge an incoming scenario list into an existing catalog by id (idempotent). */
export function mergeCatalog(
  existing: readonly TestScenario[],
  incoming: readonly TestScenario[],
): TestScenario[] {
  const byId = new Map(existing.map((scenario) => [scenario.id, scenario]));
  for (const scenario of incoming) byId.set(scenario.id, scenario);
  return [...byId.values()];
}

function defaultConfidence(source: ProposalSource): number {
  switch (source) {
    case "discovery":
      return 0.9;
    case "manual":
      return 0.95;
    case "ai":
      return 0.7;
    case "import":
      return 0.8;
  }
}

function toScenario(proposal: ScenarioProposal, confidence: number): TestScenario {
  const steps = proposal.steps.map((step, index) => toScenarioStep(step, index, proposal.risk));
  const draft = {
    schemaVersion: 1,
    name: proposal.name,
    description: proposal.description,
    source: SOURCE_MAP[proposal.source],
    confidence,
    moduleIds: proposal.moduleId ? [proposal.moduleId] : [],
    routeIds: proposal.routeId ? [proposal.routeId] : [],
    operationIds: [] as string[],
    roleIds: [...proposal.roleIds],
    tags: [...proposal.tags],
    risk: proposal.risk,
    steps,
    evidence: [] as const,
    createdAt: proposal.createdAt,
  };
  // Drop undefined fields so the content digest is deterministic and JSON-safe.
  const clean = stripUndefined(draft);
  const scenario: TestScenario = {
    ...clean,
    id: stableId(
      "scenario",
      clean.name,
      clean.routeIds,
      clean.roleIds,
      clean.steps,
      clean.risk,
      clean.tags,
      clean.moduleIds,
    ),
  };
  // Re-run the catalog validator so a malformed proposal can never reach the catalog.
  validateScenario(scenario, `imported.scenarios[${proposal.id}]`);
  return scenario;
}

/** Recursively remove `undefined` values so objects serialize cleanly. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) output[key] = stripUndefined(item);
    }
    return output as T;
  }
  return value;
}

function toScenarioStep(step: ScenarioProposal["steps"][number], index: number, risk: ActionRisk): ScenarioStep {
  const source = step as ScenarioProposal["steps"][number] & Record<string, unknown>;
  const id = `step-${index + 1}`;
  const name = typeof source.name === "string" ? source.name : typeof source.target === "string" ? source.target : undefined;

  switch (step.action) {
    case "navigate":
      requireString(source.url, "navigate", "url");
      return { id, name, risk, action: "navigate", url: String(source.url) };
    case "click":
      requireLocator(step, "click");
      return { id, name, risk, action: "click", locator: step.locator! };
    case "fill":
      requireLocator(step, "fill");
      requireString(source.value, "fill", "value");
      return { id, name, risk, action: "fill", locator: step.locator!, value: String(source.value) };
    case "select-option":
      requireLocator(step, "select-option");
      requireString(source.value, "select-option", "value");
      return { id, name, risk, action: "select-option", locator: step.locator!, value: String(source.value) };
    case "check":
      requireLocator(step, "check");
      return { id, name, risk, action: "check", locator: step.locator! };
    case "uncheck":
      requireLocator(step, "uncheck");
      return { id, name, risk, action: "uncheck", locator: step.locator! };
    case "press":
      requireLocator(step, "press");
      requireString(source.key, "press", "key");
      return { id, name, risk, action: "press", locator: step.locator!, key: String(source.key) };
    case "wait":
      return { id, name, risk, action: "wait" };
    case "assert":
      requireString(source.assertion, "assert", "assertion");
      return {
        id,
        name,
        risk,
        action: "assert",
        assertion: String(source.assertion) as AssertionKind,
        locator: step.locator,
        expected: source.expected as JsonValue | undefined,
      };
    case "screenshot":
      return { id, name, risk, action: "screenshot" };
    case "evaluate":
      requireString(source.expression, "evaluate", "expression");
      return { id, name, risk, action: "evaluate", expression: String(source.expression) };
    default:
      throw new TypeError(`Unsupported proposal step action '${step.action}'.`);
  }
}

function requireString(value: unknown, action: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Proposal step '${action}' requires a non-empty '${field}'.`);
  }
}

function requireLocator(step: ScenarioProposal["steps"][number], action: string): void {
  if (!step.locator || typeof step.locator !== "object") {
    throw new TypeError(`Proposal step '${action}' requires a locator.`);
  }
}
