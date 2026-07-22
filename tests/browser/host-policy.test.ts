import { describe, expect, it } from "vitest";

import { evaluateUrlAccess, matchesHostPattern } from "../../src/browser/host-policy.js";

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
});
