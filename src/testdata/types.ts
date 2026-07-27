/**
 * Phase 5 — 测试数据类型。
 * 测试数据以「命名空间」为隔离单元，支持可重复执行与受控清理。
 */

export type TestDataScope = "module" | "project" | "scenario";

export type TestDataKind = "entity" | "row" | "file" | "state";

export type CleanupStrategy = "auto" | "manual";

export interface TestDataRecord {
  id: string;
  kind: TestDataKind;
  name: string;
  /** 业务字段，具体结构由调用方解释。 */
  payload: Record<string, unknown>;
  /** 存活秒数；超出后即使未显式清理也视为可丢弃。 */
  ttlSeconds?: number;
  cleanup?: CleanupStrategy;
}

export interface TestDataNamespace {
  id: string;
  schemaVersion: number;
  name: string;
  moduleId: string;
  scope: TestDataScope;
  ownerRoleId?: string;
  records: TestDataRecord[];
  /** 清理顺序（record id 列表）；缺省按 records 逆序。 */
  cleanupOrder?: string[];
}

export interface TestDataCleanupPlan {
  namespaceId: string;
  order: string[];
  /** 某条清理失败时的策略：abort 中止后续，continue 继续。 */
  onFailure: "abort" | "continue";
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
