import type { Inventory } from "../core/types.js";
import type { BusinessActionNode, PermissionNode, PermissionMatrix, PermissionMatrixEntry } from "./types.js";

/**
 * 由业务动作推导出权限节点。公开动作（requiredRoleIds 为空）视为无限制，
 * 其权限节点 roleIds 为空，表示「无需特定角色」。
 */
export function extractPermissions(inventory: Inventory, actions: readonly BusinessActionNode[]): PermissionNode[] {
  return actions
    .map<PermissionNode>((a) => ({
      id: `perm:${a.id}`,
      kind: "permission",
      name: `权限-${a.name}`,
      moduleId: a.moduleId,
      actionId: a.id,
      roleIds: [...a.requiredRoleIds],
      effect: "allow",
    }))
    .sort((x, y) => x.id.localeCompare(y.id));
}

function entryFor(a: BusinessActionNode, roleIds: string[]): PermissionMatrixEntry {
  const allowed = a.requiredRoleIds;
  const denied = allowed.length > 0 ? roleIds.filter((r) => !allowed.includes(r)) : [];
  return {
    actionId: a.id,
    actionName: a.name,
    allowedRoleIds: [...allowed],
    deniedRoleIds: denied,
    unassignedRoleIds: [],
  };
}

/**
 * 按模块构建「角色 × 动作」权限矩阵。allowed 为显式授予的角色；
 * 当动作存在限制时，denied 为其余角色；公开动作两者均为空。
 */
export function buildPermissionMatrix(actions: readonly BusinessActionNode[], roleIds: string[]): PermissionMatrix[] {
  const modules = Array.from(new Set(actions.map((a) => a.moduleId))).sort();
  return modules.map((moduleId) => ({
    moduleId,
    entries: actions
      .filter((a) => a.moduleId === moduleId)
      .map((a) => entryFor(a, roleIds))
      .sort((x, y) => x.actionId.localeCompare(y.actionId)),
  }));
}

export function buildPermissionModel(inventory: Inventory, actions: readonly BusinessActionNode[]): PermissionMatrix[] {
  const roleIds = inventory.nodes
    .filter((n) => n.kind === "role")
    .map((n) => n.id)
    .sort();
  return buildPermissionMatrix(actions, roleIds);
}
