import { describe, expect, it } from "vitest";

import {
  classifyRequestRisk,
  evaluateRequestAccess,
  evaluateUrlAccess,
  matchesHostPattern,
} from "../../src/browser/host-policy.js";

describe("browser host policy", () => {
  const policy = { baseUrl: "http://app.test:3000", allowedHosts: [], blockedHosts: [] };

  it("allows the base origin and relative URLs", () => {
    expect(evaluateUrlAccess("/dashboard", policy)).toMatchObject({ allowed: true, reason: "allowed-base-origin" });
    expect(evaluateUrlAccess("http://app.test:3000/orders", policy)).toMatchObject({ allowed: true });
  });

  it("blocks external origins unless explicitly allowlisted", () => {
    expect(evaluateUrlAccess("https://cdn.test/app.js", policy)).toMatchObject({ allowed: false, reason: "external-host" });
    expect(evaluateUrlAccess("https://cdn.test/app.js", { ...policy, allowedHosts: ["cdn.test"] })).toMatchObject({
      allowed: true,
      reason: "allowed-host",
    });
  });

  it("gives blocked patterns precedence over allowed patterns", () => {
    const decision = evaluateUrlAccess("https://cdn.test/app.js", {
      ...policy,
      allowedHosts: ["*.test"],
      blockedHosts: ["cdn.test"],
    });
    expect(decision).toMatchObject({ allowed: false, reason: "blocked-host" });
  });

  it("rejects credentials and unsupported protocols", () => {
    expect(evaluateUrlAccess("http://user:password@app.test:3000/", policy)).toMatchObject({
      allowed: false,
      reason: "credentials-in-url",
    });
    expect(evaluateUrlAccess("file:///tmp/index.html", policy)).toMatchObject({
      allowed: false,
      reason: "unsupported-protocol",
    });
  });

  it("matches exact and wildcard host patterns without allowing the wildcard apex", () => {
    expect(matchesHostPattern(new URL("https://api.example.test/v1"), "api.example.test")).toBe(true);
    expect(matchesHostPattern(new URL("https://a.example.test/v1"), "*.example.test")).toBe(true);
    expect(matchesHostPattern(new URL("https://example.test/v1"), "*.example.test")).toBe(false);
  });

  it("blocks non-read request methods under the default read-only policy", () => {
    expect(classifyRequestRisk("GET")).toBe("read");
    expect(classifyRequestRisk("POST")).toBe("mutate");
    expect(classifyRequestRisk("WEBSOCKET")).toBe("mutate");
    expect(classifyRequestRisk("DELETE")).toBe("destructive");
    expect(classifyRequestRisk("X-NEW-METHOD")).toBe("destructive");

    expect(evaluateRequestAccess("http://app.test:3000/api/orders", "GET", {
      ...policy,
      maxRisk: "read",
    })).toMatchObject({ allowed: true, risk: "read" });
    expect(evaluateRequestAccess("http://app.test:3000/api/orders", "POST", {
      ...policy,
      maxRisk: "read",
    })).toMatchObject({ allowed: false, reason: "request-method-blocked", risk: "mutate" });
  });

  it("allows approved mutation methods but still blocks destructive methods", () => {
    const mutatePolicy = { ...policy, maxRisk: "mutate" as const };
    expect(evaluateRequestAccess("http://app.test:3000/api/orders", "POST", mutatePolicy)).toMatchObject({
      allowed: true,
      risk: "mutate",
    });
    expect(evaluateRequestAccess("http://app.test:3000/api/orders/1", "DELETE", mutatePolicy)).toMatchObject({
      allowed: false,
      reason: "request-method-blocked",
      risk: "destructive",
    });
    expect(evaluateRequestAccess("http://app.test:3000/api/orders/1", "CONNECT", {
      ...policy,
      maxRisk: "destructive",
    })).toMatchObject({
      allowed: false,
      reason: "request-method-blocked",
      risk: "destructive",
    });
  });

  it("requires explicit external-origin opt-in and an allowlist", () => {
    expect(evaluateRequestAccess("https://cdn.test/app.js", "GET", {
      ...policy,
      maxRisk: "read",
      allowedHosts: ["cdn.test"],
    })).toMatchObject({ allowed: false, reason: "external-host" });
    expect(evaluateRequestAccess("https://cdn.test/app.js", "GET", {
      ...policy,
      maxRisk: "read",
      allowExternalOrigins: true,
      allowedHosts: ["cdn.test"],
    })).toMatchObject({ allowed: true, reason: "allowed-host" });
  });

  it("keeps the default base origin exact, including the port", () => {
    expect(evaluateRequestAccess("http://app.test:4000/health", "GET", {
      ...policy,
      maxRisk: "read",
    })).toMatchObject({ allowed: false, reason: "external-host" });
  });
});
