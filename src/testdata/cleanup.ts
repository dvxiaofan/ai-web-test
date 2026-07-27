import type { TestDataNamespace, TestDataCleanupPlan, TestDataRecord } from "./types.js";

/**
 * 由命名空间推导清理计划：
 * - 若显式指定 cleanupOrder，则按其顺序；
 * - 否则按 records 逆序（后创建的先清理，近似后进先出）。
 * - manual 策略的记录排在 auto 之后（自动清理优先，人工兜底）。
 */
export function buildCleanupPlan(ns: TestDataNamespace, onFailure: "abort" | "continue" = "continue"): TestDataCleanupPlan {
  const order = ns.cleanupOrder
    ? ns.cleanupOrder.slice()
    : deriveDefaultOrder(ns.records);
  return { namespaceId: ns.id, order, onFailure };
}

function deriveDefaultOrder(records: TestDataRecord[]): string[] {
  const auto = records.filter((r) => r.cleanup !== "manual").map((r) => r.id);
  const manual = records.filter((r) => r.cleanup === "manual").map((r) => r.id);
  return [...auto.reverse(), ...manual.reverse()];
}

/**
 * 计算在某条记录清理失败后的剩余顺序。
 * onFailure=abort 时返回已失败项 + 中止标记；continue 时跳过失败项继续。
 */
export function orderAfterFailure(
  plan: TestDataCleanupPlan,
  failedId: string,
): { remaining: string[]; aborted: boolean } {
  const idx = plan.order.indexOf(failedId);
  if (idx < 0) return { remaining: plan.order, aborted: false };
  if (plan.onFailure === "abort") {
    return { remaining: plan.order.slice(0, idx + 1), aborted: true };
  }
  return { remaining: plan.order.filter((id) => id !== failedId), aborted: false };
}
