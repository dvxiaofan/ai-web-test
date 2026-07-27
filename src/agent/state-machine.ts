import type { AgentState } from "./protocol.js";

/** Phase 1.2 — project lifecycle state machine. */

export const INITIAL_PROJECT_STATUS: AgentState = "initialized";

export const PROJECT_STATUS_TRANSITIONS: Record<AgentState, AgentState[]> = {
  initialized: ["discovered"],
  discovered: ["plan_proposed"],
  plan_proposed: ["plan_approved", "discovered"],
  plan_approved: ["running"],
  running: ["completed", "failed"],
  completed: ["discovered"],
  failed: ["discovered", "plan_approved"],
};

export function canTransition(from: AgentState, to: AgentState): boolean {
  return PROJECT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: AgentState): AgentState[] {
  return PROJECT_STATUS_TRANSITIONS[from] ?? [];
}
