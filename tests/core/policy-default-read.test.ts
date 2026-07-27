import { describe, expect, it } from "vitest";

import { DEFAULT_TEST_POLICY, createDefaultPolicy, validateConfig } from "../../src/core/index.js";

/**
 * Batch 0.2 lock-in: the default execution policy must always be read-only.
 * This guards against accidental regressions that would let the tool mutate
 * or reach external origins by default.
 */
describe("default execution policy is read-only", () => {
  it("keeps DEFAULT_TEST_POLICY at read risk with safe defaults", () => {
    expect(DEFAULT_TEST_POLICY.maxRisk).toBe("read");
    // allowedHosts is empty at the constant level; validateConfig injects
    // ["localhost"] so the resolved config stays host-restricted.
    expect(DEFAULT_TEST_POLICY.allowedHosts).toEqual([]);
    expect(DEFAULT_TEST_POLICY.destructiveActionAllowlist).toEqual([]);
    // A read-only default must refuse anything beyond observation.
    expect(DEFAULT_TEST_POLICY.allowExternalOrigins).toBe(false);
    expect(DEFAULT_TEST_POLICY.allowSecretPersistence).toBe(false);
    expect(DEFAULT_TEST_POLICY.allowTargetCodeChanges).toBe(false);
    expect(DEFAULT_TEST_POLICY.allowProductionLikeHosts).toBe(false);
    expect(DEFAULT_TEST_POLICY.confirmationRequired).toBe(true);
  });

  it("keeps createDefaultPolicy read-only with and without a base URL", () => {
    expect(createDefaultPolicy().maxRisk).toBe("read");
    expect(createDefaultPolicy("http://localhost:3000").maxRisk).toBe("read");
    expect(createDefaultPolicy("http://localhost:3000").allowedHosts).toContain("localhost");
  });

  it("resolves the default policy to read through validateConfig", () => {
    const config = validateConfig(
      { target: { rootDir: "./sample", baseUrl: "http://localhost:4173" } },
      { configDir: "/tmp/ai-web-test-config" },
    );

    expect(config.policy.maxRisk).toBe("read");
    expect(config.policy.allowedHosts).toEqual(["localhost"]);
  });
});
