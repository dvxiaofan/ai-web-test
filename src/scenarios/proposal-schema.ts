import type { ActionRisk, ScenarioProposal } from "../core/types.js";

/**
 * Phase 3 — field-level structural validation for `ScenarioProposal`.
 *
 * This module only checks that a proposal object has the expected shape and
 * primitive types. Semantic checks (inventory references, risk policy,
 * duplicate detection) live in `validator.ts`. Keeping the two layers separate
 * lets callers validate cheaply and collect all shape errors at once.
 */

export interface ShapeValidationResult {
  valid: boolean;
  errors: string[];
}

const KNOWN_RISKS: readonly ActionRisk[] = ["read", "mutate", "destructive"];
const KNOWN_SOURCES = ["discovery", "ai", "manual", "import"] as const;
const KNOWN_STATUSES = ["pending", "accepted", "rejected"] as const;
const KNOWN_EVIDENCE_TYPES = ["locator", "route", "role", "screenshot", "trace", "observation"] as const;

export function validateProposalShape(value: unknown, path = "proposal"): ShapeValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: [`${path} must be an object.`] };
  }
  const record = value as Record<string, unknown>;

  expectString(record.id, `${path}.id`, errors);
  expectNumber(record.schemaVersion, `${path}.schemaVersion`, errors);
  expectString(record.name, `${path}.name`, errors);
  expectEnum(record.source, KNOWN_SOURCES, `${path}.source`, errors);
  expectOptionalString(record.description, `${path}.description`, errors);
  expectOptionalString(record.moduleId, `${path}.moduleId`, errors);
  expectOptionalString(record.routeId, `${path}.routeId`, errors);
  expectOptionalString(record.pageId, `${path}.pageId`, errors);
  expectOptionalString(record.pageUrl, `${path}.pageUrl`, errors);
  expectOptionalString(record.expectedOutcome, `${path}.expectedOutcome`, errors);
  expectOptionalString(record.rejectionReason, `${path}.rejectionReason`, errors);
  expectEnum(record.status, KNOWN_STATUSES, `${path}.status`, errors);
  expectEnum(record.risk, KNOWN_RISKS, `${path}.risk`, errors);
  expectIsoDate(record.createdAt, `${path}.createdAt`, errors);

  expectStringArray(record.roleIds, `${path}.roleIds`, errors);
  expectStringArray(record.tags, `${path}.tags`, errors);

  if (!Array.isArray(record.steps)) {
    errors.push(`${path}.steps must be an array.`);
  } else {
    record.steps.forEach((step, index) => {
      validateStepShape(step, `${path}.steps[${index}]`, errors);
    });
  }

  if (!Array.isArray(record.evidence)) {
    errors.push(`${path}.evidence must be an array.`);
  } else {
    record.evidence.forEach((evidence, index) => {
      validateEvidenceShape(evidence, `${path}.evidence[${index}]`, errors);
    });
  }

  return { valid: errors.length === 0, errors };
}

function validateStepShape(step: unknown, path: string, errors: string[]): void {
  if (typeof step !== "object" || step === null || Array.isArray(step)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const record = step as Record<string, unknown>;
  expectString(record.action, `${path}.action`, errors);
  expectOptionalString(record.target, `${path}.target`, errors);
  expectOptionalString(record.value, `${path}.value`, errors);
  expectOptionalString(record.url, `${path}.url`, errors);
  expectOptionalString(record.description, `${path}.description`, errors);
  if (record.locator !== undefined && (typeof record.locator !== "object" || record.locator === null)) {
    errors.push(`${path}.locator must be an object when present.`);
  }
}

function validateEvidenceShape(evidence: unknown, path: string, errors: string[]): void {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const record = evidence as Record<string, unknown>;
  expectEnum(record.type, KNOWN_EVIDENCE_TYPES, `${path}.type`, errors);
  expectString(record.value, `${path}.value`, errors);
}

function expectString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${path} must be a string.`);
}

function expectNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be a number.`);
}

function expectOptionalString(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined) expectString(value, path, errors);
}

function expectIsoDate(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be a valid ISO date string.`);
  }
}

function expectStringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string") errors.push(`${path}[${index}] must be a string.`);
  });
}

function expectEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}.`);
  }
}
