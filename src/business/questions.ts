import type { BusinessGap, BusinessQuestion } from "./types.js";

const PRIORITY_BY_SEVERITY: Record<BusinessGap["severity"], BusinessQuestion["priority"]> = {
  error: "high",
  warn: "medium",
  info: "low",
};

/**
 * 将覆盖率缺口转化为需要人工确认的业务问题。
 * 每条问题 id 内容寻址（bq:<gapType>:<targetId>），便于去重与追踪。
 */
export function collectBusinessQuestions(gaps: readonly BusinessGap[]): BusinessQuestion[] {
  const questions: BusinessQuestion[] = [];
  for (const gap of gaps) {
    let question = "";
    switch (gap.type) {
      case "uncovered-action":
        question = `业务动作「${gap.targetName}」是否需要补充业务规则与权限校验？`;
        break;
      case "role-without-permission":
        question = `角色「${gap.targetName}」是否应被授权访问某些业务动作？`;
        break;
      case "uncovered-state-transition":
        question = `状态迁移「${gap.targetName}」引用了缺失状态，请确认状态模型是否正确。`;
        break;
      case "orphan-entity":
        question = `实体「${gap.targetName}」是否有对应的业务动作？`;
        break;
    }
    questions.push({
      id: `bq:${gap.type}:${gap.targetId}`,
      moduleId: gap.moduleId,
      question,
      context: gap.detail,
      priority: PRIORITY_BY_SEVERITY[gap.severity],
    });
  }
  return questions.sort((a, b) => a.id.localeCompare(b.id));
}
