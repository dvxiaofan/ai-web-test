import type { Inventory } from "../core/types.js";
import type {
  BusinessInventory,
  BusinessGap,
  BusinessCoverage,
  BusinessCoverageReport,
  BusinessActionNode,
  BusinessRuleNode,
  PermissionNode,
  StateNode,
  StateTransitionNode,
  EntityNode,
} from "./types.js";

/**
 * 计算 Business Inventory 的覆盖率缺口：
 * - uncovered-action：动作既无业务规则也无权限约束（中危）
 * - role-without-permission：角色未被任何权限授予（低危）
 * - uncovered-state-transition：状态迁移引用了不存在的状态（高危）
 * - orphan-entity：实体未被任何动作引用（低危）
 */
export function computeBusinessGaps(inventory: Inventory, business: BusinessInventory): BusinessGap[] {
  const nodes = Object.values(business.nodes);
  const actions = nodes.filter((n): n is BusinessActionNode => n.kind === "business-action");
  const rules = nodes.filter((n): n is BusinessRuleNode => n.kind === "business-rule");
  const permissions = nodes.filter((n): n is PermissionNode => n.kind === "permission");
  const states = nodes.filter((n): n is StateNode => n.kind === "state");
  const transitions = nodes.filter((n): n is StateTransitionNode => n.kind === "state-transition");
  const entities = nodes.filter((n): n is EntityNode => n.kind === "entity");

  const gaps: BusinessGap[] = [];

  const ruleActionIds = new Set(rules.flatMap((r) => r.appliesTo));
  const permActionIds = new Set(permissions.map((p) => p.actionId));
  for (const a of actions) {
    const hasRule = ruleActionIds.has(a.id) || a.ruleIds.length > 0;
    const hasPerm = permActionIds.has(a.id);
    if (!hasRule && !hasPerm) {
      gaps.push({
        type: "uncovered-action",
        moduleId: a.moduleId,
        targetId: a.id,
        targetName: a.name,
        severity: "warn",
        detail: `业务动作「${a.name}」既无业务规则也无权限约束`,
      });
    }
  }

  const grantedRoles = new Set(permissions.flatMap((p) => p.roleIds));
  const roleIds = inventory.nodes
    .filter((n) => n.kind === "role")
    .map((n) => ({ id: n.id, name: "name" in n ? n.name : n.id }));
  for (const role of roleIds) {
    if (!grantedRoles.has(role.id)) {
      gaps.push({
        type: "role-without-permission",
        moduleId: "global",
        targetId: role.id,
        targetName: role.name,
        severity: "info",
        detail: `角色「${role.name}」未被任何权限授予`,
      });
    }
  }

  const stateIds = new Set(states.map((s) => s.id));
  for (const t of transitions) {
    if (!stateIds.has(t.fromStateId) || !stateIds.has(t.toStateId)) {
      gaps.push({
        type: "uncovered-state-transition",
        moduleId: t.moduleId,
        targetId: t.id,
        targetName: t.name,
        severity: "error",
        detail: `状态迁移「${t.name}」引用了不存在的状态`,
      });
    }
  }

  const actionEntityIds = new Set(actions.map((a) => a.entityId).filter((x): x is string => Boolean(x)));
  for (const e of entities) {
    if (!actionEntityIds.has(e.id)) {
      gaps.push({
        type: "orphan-entity",
        moduleId: e.moduleId,
        targetId: e.id,
        targetName: e.name,
        severity: "info",
        detail: `实体「${e.name}」未被任何业务动作引用`,
      });
    }
  }

  return gaps.sort((a, b) => `${a.type}/${a.targetId}`.localeCompare(`${b.type}/${b.targetId}`));
}

/**
 * 计算业务维度的覆盖率：每个模块统计动作总数、带规则/权限的动作数，
 * 以及状态与迁移数，得出该模块业务覆盖率。
 */
export function computeBusinessCoverage(inventory: Inventory, business: BusinessInventory): BusinessCoverageReport {
  const nodes = Object.values(business.nodes);
  const actions = nodes.filter((n): n is BusinessActionNode => n.kind === "business-action");
  const permissions = nodes.filter((n): n is PermissionNode => n.kind === "permission");
  const states = nodes.filter((n): n is StateNode => n.kind === "state");
  const transitions = nodes.filter((n): n is StateTransitionNode => n.kind === "state-transition");

  const moduleIds = Array.from(new Set(actions.map((a) => a.moduleId))).sort();
  const modules: BusinessCoverage[] = moduleIds.map((moduleId) => {
    const modActions = actions.filter((a) => a.moduleId === moduleId);
    const actionsTotal = modActions.length;
    const actionsWithRules = modActions.filter((a) => a.ruleIds.length > 0).length;
    const actionsWithPermissions = modActions.filter((a) =>
      permissions.some((p) => p.actionId === a.id),
    ).length;
    const coveredActions = modActions.filter(
      (a) => a.ruleIds.length > 0 && permissions.some((p) => p.actionId === a.id),
    ).length;
    return {
      moduleId,
      actionsTotal,
      actionsWithRules,
      actionsWithPermissions,
      statesTotal: states.filter((s) => s.moduleId === moduleId).length,
      transitionsTotal: transitions.filter((t) => t.moduleId === moduleId).length,
      coverageRatio: actionsTotal === 0 ? 1 : coveredActions / actionsTotal,
    };
  });

  const totalActions = actions.length;
  const covered = actions.filter(
    (a) => a.ruleIds.length > 0 && permissions.some((p) => p.actionId === a.id),
  ).length;

  return {
    project: inventory.project.name,
    modules,
    summary: {
      actions: totalActions,
      coveredActions: covered,
      coverageRatio: totalActions === 0 ? 1 : covered / totalActions,
    },
  };
}
