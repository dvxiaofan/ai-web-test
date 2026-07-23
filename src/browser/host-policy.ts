import type { ActionRisk } from "../core/types.js";
import type { UrlAccessDecision, UrlAccessPolicy } from "./types.js";

const LOCAL_SCHEMES = new Set(["about:", "blob:", "data:"]);
const WEB_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
// WebSocket is deliberately absent: message payloads cannot yet be assigned a
// trustworthy business-action risk, so execution blocks sockets fail-closed.
const SUPPORTED_REQUEST_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * A request policy is the small, immutable part of the run policy that can be
 * enforced at the browser network boundary.  Keeping this separate from the
 * full TestPolicy makes the guard useful to embedders without coupling it to
 * Playwright types.
 */
export interface BrowserRequestPolicy extends UrlAccessPolicy {
  /** Whether an explicitly allowlisted origin other than the base may be used. */
  allowExternalOrigins?: boolean;
  /** Maximum HTTP-method risk approved for this run. Defaults to read. */
  maxRisk?: ActionRisk;
}

export interface RequestAccessDecision extends UrlAccessDecision {
  method: string;
  risk: ActionRisk;
}

/**
 * Decide whether a browser request may leave the current process.
 *
 * The target base origin is implicitly allowed. Block rules have precedence,
 * and an empty allowlist does not grant access to any additional origin.
 */
export function evaluateUrlAccess(candidate: string, policy: UrlAccessPolicy): UrlAccessDecision {
  let base: URL;
  let url: URL;
  try {
    base = new URL(policy.baseUrl);
    url = new URL(candidate, base);
  } catch {
    return { allowed: false, reason: "invalid-url" };
  }

  if (LOCAL_SCHEMES.has(url.protocol)) {
    return { allowed: true, reason: "allowed-local-scheme", url: url.href, origin: url.origin };
  }
  if (!WEB_SCHEMES.has(url.protocol)) {
    return { allowed: false, reason: "unsupported-protocol", url: url.href, origin: url.origin };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { allowed: false, reason: "credentials-in-url", url: url.href, origin: url.origin };
  }

  if (matchesAnyHostPattern(url, policy.blockedHosts ?? [])) {
    return { allowed: false, reason: "blocked-host", url: url.href, origin: url.origin };
  }
  if (transportOrigin(url) === transportOrigin(base)) {
    return { allowed: true, reason: "allowed-base-origin", url: url.href, origin: url.origin };
  }
  if (matchesAnyHostPattern(url, policy.allowedHosts ?? [])) {
    return { allowed: true, reason: "allowed-host", url: url.href, origin: url.origin };
  }
  return { allowed: false, reason: "external-host", url: url.href, origin: url.origin };
}

function transportOrigin(url: URL): string {
  const normalized = new URL(url.href);
  if (normalized.protocol === 'ws:') normalized.protocol = 'http:';
  if (normalized.protocol === 'wss:') normalized.protocol = 'https:';
  return normalized.origin;
}

export function assertUrlAllowed(candidate: string, policy: UrlAccessPolicy): URL {
  const decision = evaluateUrlAccess(candidate, policy);
  if (!decision.allowed || decision.url === undefined) {
    throw new Error(`Browser navigation blocked (${decision.reason}): ${candidate}`);
  }
  return new URL(decision.url);
}

/**
 * Classify a browser request conservatively.  Unknown methods are treated as
 * destructive because a new method must never silently bypass a read-only run.
 */
export function classifyRequestRisk(method: string): ActionRisk {
  switch (method.trim().toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return "read";
    case "POST":
    case "PUT":
    case "PATCH":
    case "WEBSOCKET":
      return "mutate";
    case "DELETE":
    default:
      return "destructive";
  }
}

/**
 * Evaluate a request before it is allowed to leave a Playwright context.
 *
 * External origins require both `allowExternalOrigins` and an explicit host
 * allowlist.  This is intentionally stricter than accepting a bare hostname
 * in the absence of an origin opt-in.  Method risk is checked independently
 * of scenario labels so page scripts, XHR, redirects, and forms cannot turn a
 * read-only plan into a mutating request.
 */
export function evaluateRequestAccess(
  candidate: string,
  method: string,
  policy: BrowserRequestPolicy,
): RequestAccessDecision {
  const requestMethod = method.trim().toUpperCase();
  const risk = classifyRequestRisk(requestMethod);
  const maxRisk = isActionRisk(policy.maxRisk) ? policy.maxRisk : "read";

  // When external origins are disabled, deliberately discard the allowlist for
  // the URL check so a default hostname entry cannot open another origin/port.
  const allowExternalOrigins = policy.allowExternalOrigins === true;
  const urlPolicy: UrlAccessPolicy = {
    baseUrl: policy.baseUrl,
    ...(policy.blockedHosts === undefined ? {} : { blockedHosts: policy.blockedHosts }),
    ...(allowExternalOrigins && policy.allowedHosts !== undefined ? { allowedHosts: policy.allowedHosts } : {}),
  };
  const urlDecision = evaluateUrlAccess(candidate, urlPolicy);
  if (!urlDecision.allowed) {
    return requestDecision(urlDecision, requestMethod, risk);
  }

  if (!SUPPORTED_REQUEST_METHODS.has(requestMethod) || compareActionRisk(risk, maxRisk) > 0) {
    return {
      allowed: false,
      reason: "request-method-blocked",
      ...(urlDecision.url === undefined ? {} : { url: urlDecision.url }),
      ...(urlDecision.origin === undefined ? {} : { origin: urlDecision.origin }),
      method: requestMethod,
      risk,
    };
  }

  return requestDecision(urlDecision, requestMethod, risk);
}

function requestDecision(decision: UrlAccessDecision, method: string, risk: ActionRisk): RequestAccessDecision {
  return {
    allowed: decision.allowed,
    reason: decision.reason,
    ...(decision.url === undefined ? {} : { url: decision.url }),
    ...(decision.origin === undefined ? {} : { origin: decision.origin }),
    method,
    risk,
  };
}

function compareActionRisk(left: ActionRisk, right: ActionRisk): number {
  return actionRiskRank(left) - actionRiskRank(right);
}

function actionRiskRank(risk: ActionRisk): number {
  switch (risk) {
    case "read":
      return 0;
    case "mutate":
      return 1;
    case "destructive":
      return 2;
  }
}

function isActionRisk(value: unknown): value is ActionRisk {
  return value === "read" || value === "mutate" || value === "destructive";
}

export function matchesHostPattern(url: URL, rawPattern: string): boolean {
  const pattern = rawPattern.trim().toLowerCase();
  if (pattern.length === 0) {
    return false;
  }

  if (pattern.includes("://")) {
    try {
      return url.origin.toLowerCase() === new URL(pattern).origin.toLowerCase();
    } catch {
      return false;
    }
  }

  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return suffix.length > 0 && url.hostname.toLowerCase().endsWith(`.${suffix}`);
  }

  if (pattern.startsWith(".")) {
    const suffix = pattern.slice(1);
    const hostname = url.hostname.toLowerCase();
    return suffix.length > 0 && (hostname === suffix || hostname.endsWith(`.${suffix}`));
  }

  return url.host.toLowerCase() === pattern || url.hostname.toLowerCase() === pattern;
}

function matchesAnyHostPattern(url: URL, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesHostPattern(url, pattern));
}
