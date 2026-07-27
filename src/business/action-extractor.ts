import type { Inventory, RouteNode, ModuleNode } from "../core/types.js";
import type { BusinessActionNode } from "./types.js";

function singular(name: string): string {
  const trimmed = name.trim();
  if (/ies$/i.test(trimmed)) return trimmed.replace(/ies$/i, "y");
  if (/sses$/i.test(trimmed)) return trimmed.replace(/es$/i, "");
  if (/s$/i.test(trimmed) && !/ss$/i.test(trimmed)) return trimmed.replace(/s$/i, "");
  return trimmed;
}

/**
 * 由 HTTP method + 路径推断业务动词。
 * - DELETE -> delete
 * - PUT / PATCH -> update
 * - POST（含 create/new/submit/approve/cancel）-> 对应动词，否则 create
 * - GET（含 list/index/all）-> list，否则 read
 */
export function inferVerb(method: string, path: string): string {
  const m = (method || "GET").toUpperCase();
  const p = (path || "").toLowerCase();
  if (m === "DELETE") return "delete";
  if (m === "PUT" || m === "PATCH") return "update";
  if (m === "POST") {
    if (/(cancel)/.test(p)) return "cancel";
    if (/(approve|confirm)/.test(p)) return "approve";
    if (/(submit)/.test(p)) return "submit";
    if (/(create|new)/.test(p)) return "create";
    return "create";
  }
  // GET
  if (/(list|index|all|search)/.test(p)) return "list";
  // 资源详情（路径含参数段 :id 或 {id}）视为 read，否则为集合 list
  if (/[:{]\w|[/:](\w+)\?|\{\w+\}/.test(p)) return "read";
  return "list";
}

function moduleName(inventory: Inventory, moduleId: string): string {
  const mod = inventory.nodes.find(
    (n): n is ModuleNode => n.kind === "module" && n.id === moduleId,
  );
  return mod ? mod.name : moduleId;
}

/**
 * 从 Inventory 的 route/api 推导业务动作。
 * 按 (moduleId, verb) 聚合，得到每个模块的一组业务动作。
 */
export function extractBusinessActions(inventory: Inventory): BusinessActionNode[] {
  const routes = inventory.nodes.filter(
    (n): n is RouteNode => n.kind === "route",
  );

  const groups = new Map<string, { moduleId: string; verb: string; routes: RouteNode[] }>();
  for (const route of routes) {
    const method = route.methods?.[0] ?? "GET";
    const verb = inferVerb(method, route.path);
    const moduleId = route.moduleId ?? "unknown";
    const key = `${moduleId}::${verb}`;
    const group = groups.get(key);
    if (group) group.routes.push(route);
    else groups.set(key, { moduleId, verb, routes: [route] });
  }

  const actions: BusinessActionNode[] = [];
  for (const { moduleId, verb, routes: groupRoutes } of groups.values()) {
    const routeIds = groupRoutes.map((r) => r.id);
    const pageIds = Array.from(
      new Set(groupRoutes.map((r) => r.pageId).filter((p): p is string => Boolean(p))),
    );
    const requiredRoleIds = Array.from(
      new Set(groupRoutes.flatMap((r) => r.roleIds ?? [])),
    );
    const entityName = singular(moduleName(inventory, moduleId));
    actions.push({
      id: `ba:${moduleId}:${verb}`,
      kind: "business-action",
      name: `${verb} ${entityName}`,
      moduleId,
      verbs: [verb],
      entityId: undefined,
      routeIds,
      pageIds,
      statesBefore: [],
      statesAfter: [],
      requiredRoleIds,
      ruleIds: [],
    });
  }

  return actions.sort((a, b) => `${a.moduleId}/${a.name}`.localeCompare(`${b.moduleId}/${b.name}`));
}
