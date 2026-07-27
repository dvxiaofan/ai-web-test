import type { Inventory } from "../core/types.js";
import type {
  BusinessInventory,
  BusinessNode,
  BusinessActionNode,
  BusinessRuleNode,
  PermissionNode,
  StateNode,
  StateTransitionNode,
} from "./types.js";
import { extractBusinessActions } from "./action-extractor.js";
import { extractBusinessRules } from "./rule-extractor.js";
import { extractPermissions } from "./permission-model.js";

/**
 * 编排：从 Inventory 推导完整的 BusinessInventory。
 * 顺序：动作 -> 规则 -> 权限 -> （可选）状态/迁移，并把规则反向关联到动作。ruleIds。
 */
export function buildBusinessInventory(inventory: Inventory): BusinessInventory {
  const actions = extractBusinessActions(inventory);
  const rules = extractBusinessRules(inventory);
  const permissions = extractPermissions(inventory, actions);
  const states: StateNode[] = [];
  const transitions: StateTransitionNode[] = [];

  const ruleIdsByAction = new Map<string, string[]>();
  for (const rule of rules) {
    for (const target of rule.appliesTo) {
      const list = ruleIdsByAction.get(target) ?? [];
      list.push(rule.id);
      ruleIdsByAction.set(target, list);
    }
  }

  const linkedActions: BusinessActionNode[] = actions.map((a) => ({
    ...a,
    ruleIds: ruleIdsByAction.get(a.id) ?? [],
  }));

  const nodes: BusinessNode[] = [
    ...linkedActions,
    ...rules,
    ...permissions,
    ...states,
    ...transitions,
  ];

  const nodeMap: Record<string, BusinessNode> = {};
  for (const n of nodes) nodeMap[n.id] = n;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    nodes: nodeMap,
  };
}

export type { BusinessRuleNode };
