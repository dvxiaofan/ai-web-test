import type { TestDataNamespace, TestDataRecord, ValidationResult } from "./types.js";

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 内容寻址的命名空间 id，保证同 (module, name) 幂等。 */
export function stableIdForNamespace(moduleId: string, name: string): string {
  return `tdns:${moduleId}:${slug(name)}`;
}

export interface CreateNamespaceInput {
  name: string;
  moduleId: string;
  scope?: TestDataNamespace["scope"];
  ownerRoleId?: string;
  records?: TestDataRecord[];
  cleanupOrder?: string[];
}

export function createNamespace(input: CreateNamespaceInput): TestDataNamespace {
  return {
    id: stableIdForNamespace(input.moduleId, input.name),
    schemaVersion: 1,
    name: input.name,
    moduleId: input.moduleId,
    scope: input.scope ?? "module",
    records: input.records ?? [],
    ...(input.ownerRoleId !== undefined ? { ownerRoleId: input.ownerRoleId } : {}),
    ...(input.cleanupOrder !== undefined ? { cleanupOrder: input.cleanupOrder } : {}),
  };
}

/** 校验命名空间形状：必填字段与 records 结构。 */
export function validateNamespaceShape(ns: TestDataNamespace): ValidationResult {
  const errors: string[] = [];
  if (!ns.id || !ns.id.startsWith("tdns:")) errors.push("namespace.id 必须是 tdns: 前缀的内容寻址 id");
  if (!ns.name || ns.name.trim().length === 0) errors.push("namespace.name 不能为空");
  if (!ns.moduleId) errors.push("namespace.moduleId 不能为空");
  if (!["module", "project", "scenario"].includes(ns.scope)) errors.push("namespace.scope 非法");
  if (!Array.isArray(ns.records)) errors.push("namespace.records 必须是数组");
  else {
    for (const r of ns.records) {
      if (!r.id) errors.push("record.id 不能为空");
      if (!["entity", "row", "file", "state"].includes(r.kind)) errors.push(`record ${r.id ?? "?"} 的 kind 非法`);
      if (typeof r.payload !== "object" || r.payload === null) errors.push(`record ${r.id ?? "?"} 的 payload 必须是对象`);
    }
  }
  if (ns.cleanupOrder) {
    const ids = new Set(ns.records.map((r) => r.id));
    for (const id of ns.cleanupOrder) {
      if (!ids.has(id)) errors.push(`cleanupOrder 引用了不存在的 record: ${id}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
