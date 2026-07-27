import type { Inventory, ModuleNode, RouteNode, ApiNode, PageNode, RoleNode } from "../core/types.js";

/**
 * Phase 4 — Business Inventory 领域类型。
 *
 * Business Inventory 与 Core Inventory 共享同一坐标系（moduleId / routeId /
 * pageId / roleId），但作为独立的领域对象存在，避免污染 Core 的节点联合类型与
 * 既有的覆盖率统计逻辑。业务节点通过 moduleId 等引用 Core Inventory 中的节点。
 */

export type BusinessNodeKind =
  | "entity"
  | "business-action"
  | "business-rule"
  | "permission"
  | "state"
  | "state-transition";

export interface EntityNode {
  id: string;
  kind: "entity";
  name: string;
  moduleId: string;
  fields: Array<{ name: string; type: string; required?: boolean }>;
  metadata?: { source?: string; notes?: string };
}

export interface BusinessActionNode {
  id: string;
  kind: "business-action";
  name: string;
  moduleId: string;
  verbs: string[];
  entityId?: string;
  routeIds: string[];
  pageIds: string[];
  statesBefore: string[];
  statesAfter: string[];
  requiredRoleIds: string[];
  ruleIds: string[];
  metadata?: { source?: string; notes?: string };
}

export interface BusinessRuleNode {
  id: string;
  kind: "business-rule";
  name: string;
  moduleId: string;
  severity: "info" | "warn" | "error";
  scope: "field" | "action" | "state" | "cross-module";
  appliesTo: string[];
  description: string;
  metadata?: { source?: string; notes?: string };
}

export interface PermissionNode {
  id: string;
  kind: "permission";
  name: string;
  moduleId: string;
  actionId: string;
  roleIds: string[];
  effect: "allow" | "deny";
  metadata?: { source?: string; notes?: string };
}

export interface StateNode {
  id: string;
  kind: "state";
  name: string;
  moduleId: string;
  entityId?: string;
  isInitial?: boolean;
  isTerminal?: boolean;
  metadata?: { source?: string; notes?: string };
}

export interface StateTransitionNode {
  id: string;
  kind: "state-transition";
  name: string;
  moduleId: string;
  fromStateId: string;
  toStateId: string;
  actionId: string;
  metadata?: { source?: string; notes?: string };
}

export type BusinessNode =
  | EntityNode
  | BusinessActionNode
  | BusinessRuleNode
  | PermissionNode
  | StateNode
  | StateTransitionNode;

export interface BusinessEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

export interface BusinessInventory {
  schemaVersion: number;
  generatedAt: string;
  nodes: Record<string, BusinessNode>;
}

/** 单模块的聚合业务视图。 */
export interface BusinessModuleView {
  moduleId: string;
  moduleName: string;
  entities: EntityNode[];
  actions: BusinessActionNode[];
  rules: BusinessRuleNode[];
  permissions: PermissionNode[];
  states: StateNode[];
  transitions: StateTransitionNode[];
}

/** 由业务动作推导出的状态机模型。 */
export interface StateModel {
  moduleId: string;
  states: StateNode[];
  transitions: StateTransitionNode[];
  initialStates: string[];
  terminalStates: string[];
}

/** 角色 × 动作的权限矩阵。 */
export interface PermissionMatrixEntry {
  actionId: string;
  actionName: string;
  allowedRoleIds: string[];
  deniedRoleIds: string[];
  unassignedRoleIds: string[];
}

export interface PermissionMatrix {
  moduleId: string;
  entries: PermissionMatrixEntry[];
}

export type BusinessGapType =
  | "uncovered-action"
  | "uncovered-rule"
  | "uncovered-state-transition"
  | "role-without-permission"
  | "orphan-entity";

export interface BusinessGap {
  type: BusinessGapType;
  moduleId: string;
  targetId: string;
  targetName: string;
  severity: "info" | "warn" | "error";
  detail: string;
}

export interface BusinessQuestion {
  id: string;
  moduleId: string;
  question: string;
  context?: string;
  priority: "low" | "medium" | "high";
}

export interface BusinessCoverage {
  moduleId: string;
  actionsTotal: number;
  actionsWithRules: number;
  actionsWithPermissions: number;
  statesTotal: number;
  transitionsTotal: number;
  coverageRatio: number;
}

/** 业务维度在总覆盖率报告中的可选呈现。 */
export interface BusinessCoverageReport {
  project: string;
  modules: BusinessCoverage[];
  summary: { actions: number; coveredActions: number; coverageRatio: number };
}

export type { Inventory, ModuleNode, RouteNode, ApiNode, PageNode, RoleNode };
