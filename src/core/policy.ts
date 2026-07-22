import type { ActionRisk, TestPolicy } from "./types.js";

const RISK_ORDER: Record<ActionRisk, number> = {
  read: 0,
  mutate: 1,
  destructive: 2,
};

export const DEFAULT_TEST_POLICY: Readonly<TestPolicy> = Object.freeze({
  maxRisk: "read",
  allowedHosts: [],
  blockedHosts: [],
  allowExternalOrigins: false,
  allowedActionNames: [],
  blockedActionNames: [],
  destructiveActionAllowlist: [],
  allowSecretPersistence: false,
  allowTargetCodeChanges: false,
  requireTestDataNamespace: true,
  allowProductionLikeHosts: false,
  productionLikeHostPatterns: ["prod", "production", "live"],
  redactHeaders: ["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key"],
  redactFields: ["password", "passwd", "token", "secret", "apiKey", "accessToken", "refreshToken"],
  confirmationRequired: true,
});

export interface PolicyAction {
  name: string;
  risk: ActionRisk;
  url?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  code:
    | "allowed"
    | "risk-exceeds-plan"
    | "action-blocked"
    | "action-not-allowed"
    | "destructive-action-not-allowed"
    | "invalid-url"
    | "host-blocked"
    | "host-not-allowed"
    | "external-origin-blocked"
    | "production-host-blocked";
  reason: string;
}

export class PolicyViolationError extends Error {
  readonly decision: PolicyDecision;
  readonly action: PolicyAction;

  constructor(action: PolicyAction, decision: PolicyDecision) {
    super(decision.reason);
    this.name = "PolicyViolationError";
    this.action = action;
    this.decision = decision;
  }
}

export function createDefaultPolicy(baseUrl?: string): TestPolicy {
  const allowedHosts = baseUrl === undefined ? [] : [new URL(baseUrl).hostname];
  return clonePolicy(DEFAULT_TEST_POLICY, { allowedHosts });
}

export function mergeTestPolicy(base: TestPolicy, overrides: Partial<TestPolicy>): TestPolicy {
  return clonePolicy(base, overrides);
}

export function compareRisk(left: ActionRisk, right: ActionRisk): number {
  return RISK_ORDER[left] - RISK_ORDER[right];
}

export function isRiskAllowed(policy: TestPolicy, risk: ActionRisk): boolean {
  return compareRisk(risk, policy.maxRisk) <= 0;
}

export function evaluatePolicy(policy: TestPolicy, action: PolicyAction, baseUrl?: string): PolicyDecision {
  if (!isRiskAllowed(policy, action.risk)) {
    return denied("risk-exceeds-plan", `Action ${action.name} has ${action.risk} risk, above the approved ${policy.maxRisk} level.`);
  }

  if (matchesAny(action.name, policy.blockedActionNames)) {
    return denied("action-blocked", `Action ${action.name} is blocked by policy.`);
  }

  if (policy.allowedActionNames.length > 0 && !matchesAny(action.name, policy.allowedActionNames)) {
    return denied("action-not-allowed", `Action ${action.name} is not in the approved action allowlist.`);
  }

  if (action.risk === "destructive" && !matchesAny(action.name, policy.destructiveActionAllowlist)) {
    return denied(
      "destructive-action-not-allowed",
      `Destructive action ${action.name} is not in the destructive action allowlist.`,
    );
  }

  if (action.url !== undefined) {
    const urlDecision = evaluateUrl(policy, action.url, baseUrl);
    if (!urlDecision.allowed) {
      return urlDecision;
    }
  }

  return { allowed: true, code: "allowed", reason: "Action is within the approved policy." };
}

export function assertActionAllowed(policy: TestPolicy, action: PolicyAction, baseUrl?: string): void {
  const decision = evaluatePolicy(policy, action, baseUrl);
  if (!decision.allowed) {
    throw new PolicyViolationError(action, decision);
  }
}

export function isProductionLikeHostname(hostname: string, patterns: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();
  return patterns.some((pattern) => wildcardMatches(normalized, pattern.toLowerCase()) || normalized.includes(pattern.toLowerCase()));
}

function evaluateUrl(policy: TestPolicy, rawUrl: string, baseUrl?: string): PolicyDecision {
  let url: URL;
  let base: URL | undefined;
  try {
    base = baseUrl === undefined ? undefined : new URL(baseUrl);
    url = base === undefined ? new URL(rawUrl) : new URL(rawUrl, base);
  } catch {
    return denied("invalid-url", `Action URL is invalid: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return denied("invalid-url", `Action URL uses unsupported protocol ${url.protocol}.`);
  }

  const hostname = url.hostname.toLowerCase();
  if (isProductionLikeHostname(hostname, policy.productionLikeHostPatterns) && !policy.allowProductionLikeHosts) {
    return denied("production-host-blocked", `Host ${hostname} looks production-like and is not explicitly approved.`);
  }

  if (matchesHost(hostname, url.origin, policy.blockedHosts, base)) {
    return denied("host-blocked", `Host ${hostname} is blocked by policy.`);
  }

  const sameOrigin = base !== undefined && url.origin === base.origin;
  if (!sameOrigin && !policy.allowExternalOrigins) {
    return denied("external-origin-blocked", `External origin ${url.origin} is blocked by policy.`);
  }

  if (policy.allowedHosts.length > 0 && !matchesHost(hostname, url.origin, policy.allowedHosts, base)) {
    return denied("host-not-allowed", `Host ${hostname} is not in the approved host allowlist.`);
  }

  return { allowed: true, code: "allowed", reason: "URL is within the approved policy." };
}

function clonePolicy(base: Readonly<TestPolicy>, overrides: Partial<TestPolicy>): TestPolicy {
  return {
    maxRisk: overrides.maxRisk ?? base.maxRisk,
    allowedHosts: [...(overrides.allowedHosts ?? base.allowedHosts)],
    blockedHosts: [...(overrides.blockedHosts ?? base.blockedHosts)],
    allowExternalOrigins: overrides.allowExternalOrigins ?? base.allowExternalOrigins,
    allowedActionNames: [...(overrides.allowedActionNames ?? base.allowedActionNames)],
    blockedActionNames: [...(overrides.blockedActionNames ?? base.blockedActionNames)],
    destructiveActionAllowlist: [...(overrides.destructiveActionAllowlist ?? base.destructiveActionAllowlist)],
    allowSecretPersistence: overrides.allowSecretPersistence ?? base.allowSecretPersistence,
    allowTargetCodeChanges: overrides.allowTargetCodeChanges ?? base.allowTargetCodeChanges,
    requireTestDataNamespace: overrides.requireTestDataNamespace ?? base.requireTestDataNamespace,
    ...(overrides.testDataNamespace !== undefined
      ? { testDataNamespace: overrides.testDataNamespace }
      : base.testDataNamespace !== undefined
        ? { testDataNamespace: base.testDataNamespace }
        : {}),
    allowProductionLikeHosts: overrides.allowProductionLikeHosts ?? base.allowProductionLikeHosts,
    productionLikeHostPatterns: [...(overrides.productionLikeHostPatterns ?? base.productionLikeHostPatterns)],
    redactHeaders: [...(overrides.redactHeaders ?? base.redactHeaders)],
    redactFields: [...(overrides.redactFields ?? base.redactFields)],
    confirmationRequired: overrides.confirmationRequired ?? base.confirmationRequired,
  };
}

function denied(code: Exclude<PolicyDecision["code"], "allowed">, reason: string): PolicyDecision {
  return { allowed: false, code, reason };
}

function matchesHost(hostname: string, origin: string, patterns: readonly string[], base?: URL): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.trim().toLowerCase();
    if (normalized === "self") {
      return base !== undefined && origin === base.origin;
    }
    if (normalized.includes("://")) {
      return wildcardMatches(origin.toLowerCase(), normalized);
    }
    return wildcardMatches(hostname, normalized);
  });
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  const normalized = value.toLowerCase();
  return patterns.some((pattern) => wildcardMatches(normalized, pattern.toLowerCase()));
}

function wildcardMatches(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}
