import type { Inventory, RouteNode } from "../core/types.js";
import type { BusinessRuleNode } from "./types.js";
import { inferVerb } from "./action-extractor.js";

/**
 * 从 route 的访问控制推导业务规则：
 * - 公开路由（无需认证）-> info 级「公开访问」规则
 * - 需认证但无具体角色 -> info 级「需登录」规则
 * - 需认证且有角色限制 -> warn 级「角色受限」规则
 * appliesTo 指向由该路由聚合出的业务动作 id（ba:<moduleId>:<verb>）。
 */
export function extractBusinessRules(inventory: Inventory): BusinessRuleNode[] {
  const routes = inventory.nodes.filter(
    (n): n is RouteNode => n.kind === "route" && Boolean(n.moduleId),
  );

  const rules: BusinessRuleNode[] = [];
  for (const route of routes) {
    const verb = inferVerb(route.methods?.[0] ?? "GET", route.path);
    const actionId = `ba:${route.moduleId}:${verb}`;

    if (!route.requiresAuth) {
      rules.push({
        id: `br:${route.id}:public`,
        kind: "business-rule",
        name: `公开访问 ${route.name}`,
        moduleId: route.moduleId!,
        severity: "info",
        scope: "action",
        appliesTo: [actionId],
        description: `路由 ${route.path} 无需认证即可访问`,
      });
      continue;
    }

    if (route.roleIds.length > 0) {
      const roleNames = route.roleIds.map((r) => r.replace(/^role:/, "")).join("、");
      rules.push({
        id: `br:${route.id}:role`,
        kind: "business-rule",
        name: `角色受限 ${route.name}`,
        moduleId: route.moduleId!,
        severity: "warn",
        scope: "action",
        appliesTo: [actionId],
        description: `访问 ${route.path} 仅限角色：${roleNames}`,
      });
    } else {
      rules.push({
        id: `br:${route.id}:auth`,
        kind: "business-rule",
        name: `需登录 ${route.name}`,
        moduleId: route.moduleId!,
        severity: "info",
        scope: "action",
        appliesTo: [actionId],
        description: `访问 ${route.path} 需要登录，但未限定具体角色`,
      });
    }
  }

  return rules.sort((a, b) => a.id.localeCompare(b.id));
}
