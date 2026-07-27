import type { BusinessActionNode, StateNode, StateTransitionNode, StateModel } from "./types.js";

/**
 * 由业务动作声明的 before/after 状态推导状态机模型。
 * - states：调用方提供的状态节点（带 isInitial/isTerminal 标记）
 * - transitions：每个动作的 (before → after) 组合展开为状态迁移
 * 若动作未声明任何状态，则返回空模型（该模块暂未建模生命周期）。
 */
export function buildStateModel(
  actions: readonly BusinessActionNode[],
  states: readonly StateNode[] = [],
): StateModel {
  const moduleId = states[0]?.moduleId ?? actions[0]?.moduleId ?? "unknown";

  const transitions: StateTransitionNode[] = [];
  for (const a of actions) {
    for (const before of a.statesBefore) {
      for (const after of a.statesAfter) {
        transitions.push({
          id: `stt:${a.id}:${before}->${after}`,
          kind: "state-transition",
          name: `${before} → ${after} (${a.name})`,
          moduleId: a.moduleId,
          fromStateId: before,
          toStateId: after,
          actionId: a.id,
        });
      }
    }
  }

  return {
    moduleId,
    states: [...states],
    transitions: transitions.sort((x, y) => x.id.localeCompare(y.id)),
    initialStates: states.filter((s) => s.isInitial).map((s) => s.id),
    terminalStates: states.filter((s) => s.isTerminal).map((s) => s.id),
  };
}
