import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactStore,
  ConfigValidationError,
  contentDigest,
  createDefaultPolicy,
  evaluatePolicy,
  stableId,
  stableStringify,
  validateConfig,
} from "../../src/core/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("stable JSON and identifiers", () => {
  it("sorts nested keys and produces deterministic digests", () => {
    const left = { z: 1, nested: { b: true, a: "value" } };
    const right = { nested: { a: "value", b: true }, z: 1 };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(contentDigest(left)).toBe(contentDigest(right));
    expect(stableId("Route", left)).toMatch(/^route_[a-f0-9]{20}$/);
  });

  it("rejects data that JSON would silently lose", () => {
    expect(() => stableStringify({ unsafe: undefined })).toThrow(/cannot be represented as JSON/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => stableStringify(circular)).toThrow(/Circular reference/);
  });
});

describe("configuration", () => {
  it("resolves paths and applies read-only first-run defaults", () => {
    const config = validateConfig(
      { target: { rootDir: "./sample", baseUrl: "http://localhost:4173" } },
      { configDir: "/tmp/ai-web-test-config" },
    );

    expect(config.target.rootDir).toBe("/tmp/ai-web-test-config/sample");
    expect(config.artifacts.directory).toBe("/tmp/ai-web-test-config/test-output/sample/artifacts");
    expect(config.runtime.enabled).toBe(true);
    expect(config.policy.maxRisk).toBe("read");
    expect(config.policy.allowedHosts).toEqual(["localhost"]);
    expect(config.digest).toHaveLength(64);
  });

  it("keeps default artifacts out of the target source tree and slugs project names", () => {
    const config = validateConfig(
      { project: { name: "烽火 IT 工单" }, target: { rootDir: "./sample", baseUrl: "http://localhost:4173" } },
      { configDir: "/tmp/ai-web-test-config" },
    );

    expect(config.artifacts.directory).toBe("/tmp/ai-web-test-config/test-output/烽火-it-工单/artifacts");
    expect(config.artifacts.directory.startsWith(config.target.rootDir)).toBe(false);
    expect(config.source.exclude).toContain("test-output");
  });

  it("resolves an explicit artifacts.directory relative to the config directory", () => {
    const config = validateConfig(
      { target: { rootDir: "./sample" }, artifacts: { directory: "artifacts" } },
      { configDir: "/tmp/ai-web-test-config" },
    );

    expect(config.artifacts.directory).toBe("/tmp/ai-web-test-config/artifacts");
  });

  it("rejects embedded secrets and unbounded destructive execution", () => {
    expect(() => validateConfig({ target: { env: { PASSWORD: "embedded-value" } } })).toThrow(ConfigValidationError);

    try {
      validateConfig({ policy: { maxRisk: "destructive", testDataNamespace: "e2e" } });
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).issues.some((issue) => issue.path === "policy.destructiveActionAllowlist")).toBe(true);
    }
  });
});

describe("execution policy", () => {
  it("blocks mutations and external origins by default", () => {
    const policy = createDefaultPolicy("http://localhost:3000");

    expect(evaluatePolicy(policy, { name: "view-dashboard", risk: "read", url: "/dashboard" }, "http://localhost:3000").allowed).toBe(true);
    expect(evaluatePolicy(policy, { name: "save-profile", risk: "mutate" }, "http://localhost:3000").code).toBe("risk-exceeds-plan");
    expect(evaluatePolicy(policy, { name: "navigate", risk: "read", url: "https://example.com" }, "http://localhost:3000").code).toBe("external-origin-blocked");
  });
});

describe("ArtifactStore", () => {
  it("creates the canonical layout and contains relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-web-test-core-"));
    temporaryDirectories.push(directory);
    const store = new ArtifactStore(directory);

    await store.initialize();
    await store.writeJson("cache/example.json", { ok: true });

    await expect(store.readJson("cache/example.json")).resolves.toEqual({ ok: true });
    expect(() => store.resolve("../escape.json")).toThrow(/escapes/);
    expect(store.relative(store.resolve("cache/example.json"))).toBe("cache/example.json");
  });

  it("writes a self-ignoring .gitignore once and never clobbers an existing one", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-web-test-core-"));
    temporaryDirectories.push(directory);
    const store = new ArtifactStore(directory);

    await store.initialize();
    expect(await readFile(path.join(directory, ".gitignore"), "utf8")).toBe("*\n");

    await writeFile(path.join(directory, ".gitignore"), "runs/\n", "utf8");
    await store.initialize();
    expect(await readFile(path.join(directory, ".gitignore"), "utf8")).toBe("runs/\n");
  });
});
