import type { AgentState, NextAction } from "./protocol.js";

/** Phase 1.2 — derive the next agent actions from the current state. */

export interface NextActionContext {
  projectId?: string;
  planId?: string;
}

export function deriveNextActions(state: AgentState | undefined, ctx: NextActionContext = {}): NextAction[] {
  const projectArg = ctx.projectId ? { projectId: ctx.projectId } : {};
  switch (state) {
    case "initialized":
      return [{ action: "discover", arguments: projectArg }];
    case "discovered":
      return [{ action: "plan", arguments: projectArg }];
    case "plan_proposed":
      return [
        { action: "approve", arguments: ctx.planId ? { planId: ctx.planId } : projectArg },
        { action: "run", arguments: ctx.planId ? { planId: ctx.planId } : projectArg },
      ];
    case "plan_approved":
      return [{ action: "run", arguments: ctx.planId ? { planId: ctx.planId } : projectArg }];
    case "running":
      return [];
    case "completed":
      return [{ action: "report", arguments: {} }];
    case "failed":
      return [{ action: "run", arguments: {} }];
    default:
      return [];
  }
}
