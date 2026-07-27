import { stableId } from "../core/ids.js";
import type {
  ActionRisk,
  ProposalEvidence,
  ProposalSource,
  ProposalStep,
  ScenarioProposal,
} from "../core/types.js";

/**
 * Phase 3 — proposal factory.
 *
 * `createProposal` derives a content-addressed `id` (via `stableId`), so the
 * same logical proposal drafted twice produces the same id. That idempotency
 * is what lets `importProposals` merge proposals without creating duplicates.
 */

export interface CreateProposalInput {
  name: string;
  source: ProposalSource;
  risk: ActionRisk;
  steps: ProposalStep[];
  routeId?: string;
  pageId?: string;
  pageUrl?: string;
  moduleId?: string;
  roleIds?: string[];
  tags?: string[];
  description?: string;
  expectedOutcome?: string;
  evidence?: ProposalEvidence[];
  createdAt?: string;
}

export function createProposal(input: CreateProposalInput): ScenarioProposal {
  const roleIds = (input.roleIds ?? []).filter(Boolean);
  const tags = (input.tags ?? []).filter(Boolean);
  const evidence = input.evidence ?? [];
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new TypeError("createProposal: createdAt must be a valid ISO date string.");
  }

  const id = stableId(
    "proposal",
    input.name,
    input.routeId ?? "",
    input.pageId ?? "",
    input.moduleId ?? "",
    roleIds,
    input.steps,
    input.risk,
    tags,
  );

  return {
    id,
    schemaVersion: 1,
    name: input.name,
    description: input.description,
    source: input.source,
    moduleId: input.moduleId,
    routeId: input.routeId,
    pageId: input.pageId,
    pageUrl: input.pageUrl,
    roleIds,
    tags,
    risk: input.risk,
    expectedOutcome: input.expectedOutcome,
    steps: input.steps.map((step) => ({ ...step })),
    evidence: evidence.map((item) => ({ ...item })),
    createdAt,
    status: "pending",
  };
}

/** Descriptive alias for AI-agent callers. */
export const proposeScenario = createProposal;
