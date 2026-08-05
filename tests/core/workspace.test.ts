import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type { ProjectConfig } from "../../src/core/types.js";
import { ensureWorkspace, isInsideWorkspace, resolveWorkspace } from "../../src/core/workspace.js";

function tmp(name: string): string {
  const dir = path.join(tmpdir(), `awt-workspace-${process.pid}-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildConfig(configDir: string, reportDir?: string): ProjectConfig {
  return {
    schemaVersion: 1,
    configDir,
    configPath: path.join(configDir, "config.json"),
    project: { id: "p1", name: "sample shop" },
    target: { rootDir: "/tmp/app", baseUrl: "http://localhost:4178" },
    artifacts: { directory: path.join(configDir, "artifacts") },
    report: reportDir ? { projectDirectory: reportDir } : {},
  } as unknown as ProjectConfig;
}

describe("workspace", () => {
  it("resolves every output directory under the config directory", () => {
    const root = tmp("resolve");
    const workspace = resolveWorkspace(buildConfig(root));

    expect(workspace.root).toBe(root);
    expect(workspace.configPath).toBe(path.join(root, "config.json"));
    expect(workspace.artifactsDir).toBe(path.join(root, "artifacts"));
    expect(workspace.reportDir).toBe(path.join(root, "report"));
    expect(workspace.docsDir).toBe(path.join(root, "docs"));
    expect(workspace.scriptsDir).toBe(path.join(root, "scripts"));
  });

  it("honors a report directory override", () => {
    const root = tmp("override");
    expect(resolveWorkspace(buildConfig(root, "custom-report")).reportDir).toBe(path.join(root, "custom-report"));
  });

  it("creates docs/ and scripts/ with a self-ignoring .gitignore", async () => {
    const root = tmp("ensure");
    const workspace = resolveWorkspace(buildConfig(root));
    await ensureWorkspace(workspace);

    expect(existsSync(workspace.docsDir)).toBe(true);
    expect(existsSync(workspace.scriptsDir)).toBe(true);
    expect(existsSync(path.join(workspace.docsDir, ".gitignore"))).toBe(true);
    expect(existsSync(path.join(workspace.scriptsDir, ".gitignore"))).toBe(true);
  });

  it("treats the workspace root itself as inside", () => {
    const root = tmp("inside");
    const workspace = resolveWorkspace(buildConfig(root));

    expect(isInsideWorkspace(workspace, root)).toBe(true);
    expect(isInsideWorkspace(workspace, workspace.docsDir)).toBe(true);
    expect(isInsideWorkspace(workspace, path.join(root, "..", "sibling"))).toBe(false);
  });
});
