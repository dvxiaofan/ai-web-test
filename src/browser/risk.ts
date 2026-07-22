import type { ActionRisk } from "../core/types.js";
import type { RiskCandidate, RiskClassification } from "./types.js";

const DESTRUCTIVE_KEYWORDS = [
  "delete",
  "destroy",
  "remove",
  "erase",
  "purge",
  "pay",
  "payment",
  "purchase",
  "checkout",
  "refund",
  "publish",
  "invite",
  "send",
  "删除",
  "销毁",
  "清空",
  "支付",
  "付款",
  "购买",
  "结算",
  "退款",
  "发布",
  "邀请",
  "发送",
] as const;

const MUTATION_KEYWORDS = [
  "create",
  "add",
  "save",
  "submit",
  "update",
  "edit",
  "upload",
  "apply",
  "confirm",
  "login",
  "log in",
  "logout",
  "log out",
  "sign in",
  "sign out",
  "register",
  "reset password",
  "创建",
  "新增",
  "添加",
  "保存",
  "提交",
  "更新",
  "修改",
  "编辑",
  "上传",
  "申请",
  "确认",
  "登录",
  "退出",
  "注册",
] as const;

const STATEFUL_LINK_KEYWORDS = ["logout", "log out", "signout", "sign out", "退出"] as const;
const DESTRUCTIVE_METHODS = new Set(["DELETE"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** Conservative semantic risk classification used during read-only discovery. */
export function classifyActionRisk(candidate: RiskCandidate): RiskClassification {
  const method = candidate.method?.trim().toUpperCase();
  const text = normalizeCandidateText(candidate);

  const destructiveKeyword = findKeyword(text, DESTRUCTIVE_KEYWORDS);
  if (destructiveKeyword !== undefined) {
    return {
      risk: "destructive",
      reason: `matched destructive keyword: ${destructiveKeyword}`,
      matchedKeyword: destructiveKeyword,
    };
  }
  if (method !== undefined && DESTRUCTIVE_METHODS.has(method)) {
    return { risk: "destructive", reason: `HTTP ${method} is destructive` };
  }

  if (candidate.kind === "link") {
    const statefulKeyword = findKeyword(text, STATEFUL_LINK_KEYWORDS);
    if (statefulKeyword !== undefined) {
      return {
        risk: "mutate",
        reason: `link may change session state: ${statefulKeyword}`,
        matchedKeyword: statefulKeyword,
      };
    }
    return { risk: "read", reason: "ordinary navigation link" };
  }

  const mutationKeyword = findKeyword(text, MUTATION_KEYWORDS);
  if (mutationKeyword !== undefined) {
    return {
      risk: "mutate",
      reason: `matched mutation keyword: ${mutationKeyword}`,
      matchedKeyword: mutationKeyword,
    };
  }
  if (method !== undefined && MUTATING_METHODS.has(method)) {
    return { risk: "mutate", reason: `HTTP ${method} may change state` };
  }
  if (candidate.kind === "form" && (method === undefined || method !== "GET")) {
    return { risk: "mutate", reason: "non-GET form submission may change state" };
  }
  if (candidate.kind === "control" && candidate.controlType?.toLowerCase() === "submit") {
    return { risk: "mutate", reason: "submit control may change state" };
  }

  return { risk: "read", reason: "no state-changing signal detected" };
}

export function compareRisk(left: ActionRisk, right: ActionRisk): number {
  return riskRank(left) - riskRank(right);
}

export function riskWithinLimit(risk: ActionRisk, maximum: ActionRisk): boolean {
  return compareRisk(risk, maximum) <= 0;
}

function riskRank(risk: ActionRisk): number {
  switch (risk) {
    case "read":
      return 0;
    case "mutate":
      return 1;
    case "destructive":
      return 2;
  }
}

function normalizeCandidateText(candidate: RiskCandidate): string {
  const raw = [candidate.text, candidate.ariaLabel, candidate.title, candidate.href, candidate.controlType]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  try {
    return decodeURIComponent(raw).toLowerCase().replace(/[\s_\-/.?=&]+/g, " ");
  } catch {
    return raw.toLowerCase().replace(/[\s_\-/.?=&]+/g, " ");
  }
}

function findKeyword(text: string, keywords: readonly string[]): string | undefined {
  return keywords.find((keyword) => {
    if (/[^\x00-\x7F]/.test(keyword)) return text.includes(keyword);
    const escaped = keyword.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(text);
  });
}
