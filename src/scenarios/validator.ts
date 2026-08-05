import type { ActionRisk, Inventory, ScenarioProposal, TestScenario } from "../core/types.js";
import { scenarioSignature } from "./deduplication.js";
import { validateProposalShape } from "./proposal-schema.js";

/**
 * Phase 3 — semantic validation gate for scenario proposals.
 *
 * A proposal is only accepted when it passes structural shape checks AND its
 * references (route/page/module/role) resolve against the inventory. This is
 * the control that keeps the executable scenario catalog safe: an AI proposal
 * can never be imported into a scenario that points at an unknown page or role.
 */

export interface ValidateProposalOptions {
  inventory: Inventory;
  /** Already-imported scenarios used for duplicate detection. */
  existingScenarios?: readonly TestScenario[];
  /** Other proposals in the same batch (checked for intra-batch duplicates). */
  otherProposals?: readonly ScenarioProposal[];
  /** Highest risk class permitted. Defaults to allowing any known risk. */
  maxRisk?: ActionRisk;
}

export interface ProposalValidationResult {
  status: "accepted" | "rejected";
  errors: string[];
  warnings: string[];
  /** Present when the proposal duplicates an existing or batch scenario. */
  duplicateOf?: string;
}

const RISK_RANK: Record<ActionRisk, number> = { read: 0, mutate: 1, destructive: 2 };

export function validateProposal(
  proposal: ScenarioProposal,
  options: ValidateProposalOptions,
): ProposalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const shape = validateProposalShape(proposal);
  if (!shape.valid) {
    return { status: "rejected", errors: shape.errors, warnings };
  }

  const { inventory, existingScenarios = [], otherProposals = [], maxRisk } = options;

  if (maxRisk && RISK_RANK[proposal.risk] > RISK_RANK[maxRisk]) {
    errors.push(`proposal risk '${proposal.risk}' exceeds permitted maxRisk '${maxRisk}'.`);
  }

  const nodeIds = new Set(inventory.nodes.map((node) => node.id));

  if (proposal.routeId && !nodeIds.has(proposal.routeId)) {
    errors.push(`routeId '${proposal.routeId}' is not present in the inventory.`);
  }
  if (proposal.pageId && !nodeIds.has(proposal.pageId)) {
    errors.push(`pageId '${proposal.pageId}' is not present in the inventory.`);
  }
  if (proposal.moduleId && !nodeIds.has(proposal.moduleId)) {
    errors.push(`moduleId '${proposal.moduleId}' is not present in the inventory.`);
  }

  const missingRoles = proposal.roleIds.filter((roleId) => !nodeIds.has(roleId));
  if (missingRoles.length > 0) {
    errors.push(`roleIds not found in inventory: ${missingRoles.join(", ")}.`);
  }

  if (proposal.evidence.length === 0) {
    warnings.push("Proposal has no evidence; import is allowed but traceability is weaker.");
  }

  const signature = scenarioSignature({
    routeId: proposal.routeId,
    roleIds: proposal.roleIds,
    steps: proposal.steps,
  });

  const duplicateScenario = existingScenarios.find(
    (scenario) =>
      scenarioSignature({
        routeId: scenario.routeIds[0],
        roleIds: scenario.roleIds,
        steps: scenario.steps,
      }) === signature,
  );
  if (duplicateScenario) {
    return {
      status: "rejected",
      errors: [`Proposal duplicates existing scenario '${duplicateScenario.id}'.`],
      warnings,
      duplicateOf: duplicateScenario.id,
    };
  }

  const duplicateProposal = otherProposals.find(
    (candidate) =>
      candidate !== proposal &&
      scenarioSignature({
        routeId: candidate.routeId,
        roleIds: candidate.roleIds,
        steps: candidate.steps,
      }) === signature,
  );
  if (duplicateProposal) {
    return {
      status: "rejected",
      errors: [`Proposal duplicates sibling proposal '${duplicateProposal.id}'.`],
      warnings,
      duplicateOf: duplicateProposal.id,
    };
  }

  return { status: errors.length === 0 ? "accepted" : "rejected", errors, warnings };
}
