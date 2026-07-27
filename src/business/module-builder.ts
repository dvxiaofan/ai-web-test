import type { Inventory } from "../core/types.js";
import type {
  BusinessInventory,
  BusinessModuleView,
  EntityNode,
  BusinessActionNode,
  BusinessRuleNode,
  PermissionNode,
  StateNode,
  StateTransitionNode,
} from "./types.js";

/**
 * 按模块聚合业务节点，形成每个模块的业务视图。
 * 即便某模块暂无业务节点，只要 Inventory 中存在该模块也会产出空视图，
 * 便于报告与缺口分析覆盖全量模块。
 */
export function buildBusinessModuleViews(
  inventory: Inventory,
  business: BusinessInventory,
): BusinessModuleView[] {
  const nodes = Object.values(business.nodes);
  const invModuleIds = inventory.nodes
    .filter((n) => n.kind === "module")
    .map((n) => n.id);
  const businessModuleIds = nodes.map((n) => n.moduleId);
  const allModuleIds = Array.from(new Set([...invModuleIds, ...businessModuleIds])).sort();

  const moduleName = (moduleId: string): string => {
    const mod = inventory.nodes.find(
      (n) => n.kind === "module" && n.id === moduleId,
    );
    return mod && "name" in mod ? mod.name : moduleId;
  };

  return allModuleIds.map((moduleId) => {
    const inModule = nodes.filter((n) => n.moduleId === moduleId);
    return {
      moduleId,
      moduleName: moduleName(moduleId),
      entities: inModule.filter((n): n is EntityNode => n.kind === "entity"),
      actions: inModule.filter((n): n is BusinessActionNode => n.kind === "business-action"),
      rules: inModule.filter((n): n is BusinessRuleNode => n.kind === "business-rule"),
      permissions: inModule.filter((n): n is PermissionNode => n.kind === "permission"),
      states: inModule.filter((n): n is StateNode => n.kind === "state"),
      transitions: inModule.filter((n): n is StateTransitionNode => n.kind === "state-transition"),
    } satisfies BusinessModuleView;
  });
}
