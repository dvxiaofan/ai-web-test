import type { UrlAccessDecision, UrlAccessPolicy } from "./types.js";

const LOCAL_SCHEMES = new Set(["about:", "blob:", "data:"]);
const WEB_SCHEMES = new Set(["http:", "https:"]);

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
  if (url.origin === base.origin) {
    return { allowed: true, reason: "allowed-base-origin", url: url.href, origin: url.origin };
  }
  if (matchesAnyHostPattern(url, policy.allowedHosts ?? [])) {
    return { allowed: true, reason: "allowed-host", url: url.href, origin: url.origin };
  }
  return { allowed: false, reason: "external-host", url: url.href, origin: url.origin };
}

export function assertUrlAllowed(candidate: string, policy: UrlAccessPolicy): URL {
  const decision = evaluateUrlAccess(candidate, policy);
  if (!decision.allowed || decision.url === undefined) {
    throw new Error(`Browser navigation blocked (${decision.reason}): ${candidate}`);
  }
  return new URL(decision.url);
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
