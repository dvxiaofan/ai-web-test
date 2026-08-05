import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { ConfigValidationError, collectConfigIssues, validateConfig } from "../../src/core/config.js";

const CONFIG_DIR = path.join(tmpdir(), "awt-workspace-config");

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    project: { name: "shop" },
    target: { rootDir: "/tmp/app", baseUrl: "http://localhost:4178" },
    ...overrides,
  };
}

function issueCodes(input: Record<string, unknown>): { path: string; code: string }[] {
  return collectConfigIssues(input, { configDir: CONFIG_DIR }).map(({ path: p, code }) => ({ path: p, code }));
}

describe("config workspace containment", () => {
  it("accepts relative output paths inside the workspace", () => {
    const config = validateConfig(
      baseInput({ artifacts: { directory: "artifacts" }, report: { projectDirectory: "report" } }),
      { configDir: CONFIG_DIR },
    );
    expect(config.artifacts.directory).toBe(path.join(CONFIG_DIR, "artifacts"));
    expect(config.report.projectDirectory).toBe("report");
  });

  it("accepts an absolute path that still resolves inside the workspace", () => {
    expect(
      issueCodes(baseInput({ artifacts: { directory: path.join(CONFIG_DIR, "nested", "artifacts") } })),
    ).toEqual([]);
  });

  it("rejects artifacts.directory pointing outside the workspace", () => {
    expect(issueCodes(baseInput({ artifacts: { directory: "../elsewhere/artifacts" } }))).toEqual([
      { path: "artifacts.directory", code: "workspace" },
    ]);
  });

  it("rejects an absolute artifacts.directory outside the workspace", () => {
    expect(issueCodes(baseInput({ artifacts: { directory: path.join(tmpdir(), "somewhere-else") } }))).toEqual([
      { path: "artifacts.directory", code: "workspace" },
    ]);
  });

  it("rejects report.projectDirectory pointing outside the workspace", () => {
    expect(issueCodes(baseInput({ report: { projectDirectory: "../reports" } }))).toEqual([
      { path: "report.projectDirectory", code: "workspace" },
    ]);
  });

  it("fails the whole config load, not just a warning", () => {
    expect(() =>
      validateConfig(baseInput({ artifacts: { directory: "/etc" } }), { configDir: CONFIG_DIR }),
    ).toThrow(ConfigValidationError);
  });

  it("still reports non-string paths as value issues rather than workspace issues", () => {
    expect(issueCodes(baseInput({ artifacts: { directory: 42 } }))).toEqual([
      { path: "artifacts.directory", code: "value" },
    ]);
  });
});
