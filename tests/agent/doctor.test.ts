import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type { ProjectConfig } from "../../src/core/config.js";
import { runDoctor, type DoctorFinding } from "../../src/agent/doctor.js";

const BASE_URL = "http://10.150.2.184:9090";

function tmp(name: string): string {
  const dir = path.join(tmpdir(), `awt-doctor-${process.pid}-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A workspace laid out the way `aitest init` leaves one. */
function buildWorkspaceDirs(root: string): void {
  for (const dir of ["artifacts", "artifacts/runs", "report", "docs", "scripts"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
}

function buildConfig(root: string): ProjectConfig {
  return {
    schemaVersion: 1,
    configDir: root,
    configPath: path.join(root, "config.json"),
    project: { id: "p1", name: "fit ticket" },
    target: { rootDir: "/tmp/app", baseUrl: BASE_URL },
    artifacts: { directory: path.join(root, "artifacts") },
    report: { projectDirectory: "report" },
  } as unknown as ProjectConfig;
}

function codes(findings: DoctorFinding[]): string[] {
  return findings.map((finding) => finding.code);
}

describe("doctor", () => {
  it("reports no violations for a clean, reported workspace", async () => {
    const root = tmp("clean");
    buildWorkspaceDirs(root);
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");
    const toolRoot = tmp("clean-tool");
    writeFileSync(path.join(toolRoot, "unrelated.ts"), "export const x = 1;\n");

    const report = await runDoctor(buildConfig(root), { toolRoot });

    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("flags a missing report tree as an error once runs exist", async () => {
    const root = tmp("no-report");
    buildWorkspaceDirs(root);
    mkdirSync(path.join(root, "artifacts", "runs", "run_abc"), { recursive: true });

    const report = await runDoctor(buildConfig(root), { toolRoot: tmp("no-report-tool") });

    expect(codes(report.findings)).toEqual(["report-tree-missing"]);
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.ok).toBe(false);
  });

  it("downgrades a missing report tree to a warning when nothing has run yet", async () => {
    const root = tmp("never-run");
    buildWorkspaceDirs(root);

    const report = await runDoctor(buildConfig(root), { toolRoot: tmp("never-run-tool") });

    expect(codes(report.findings)).toEqual(["report-tree-missing"]);
    expect(report.findings[0]?.severity).toBe("warning");
    expect(report.ok).toBe(true);
  });

  it("detects target-specific files that leaked into the tool checkout", async () => {
    const root = tmp("leak");
    buildWorkspaceDirs(root);
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");

    const toolRoot = tmp("leak-tool");
    mkdirSync(path.join(toolRoot, "scripts"), { recursive: true });
    writeFileSync(path.join(toolRoot, "explore.mjs"), `const baseUrl = '${BASE_URL}';\n`);
    writeFileSync(path.join(toolRoot, "scripts", "inject.mjs"), `// hits ${BASE_URL}\n`);
    writeFileSync(path.join(toolRoot, "notes.md"), `See ${BASE_URL} for details.\n`);
    writeFileSync(path.join(toolRoot, "tool-source.ts"), "export const unrelated = true;\n");

    const report = await runDoctor(buildConfig(root), { toolRoot });

    const leaks = report.findings.filter((finding) => finding.code === "leaked-file");
    expect(leaks).toHaveLength(3);
    expect(leaks.map((finding) => path.basename(finding.path ?? "")).sort()).toEqual([
      "explore.mjs",
      "inject.mjs",
      "notes.md",
    ]);
    // Markdown belongs in docs/, executable strays in scripts/.
    expect(leaks.find((f) => f.path?.endsWith("notes.md"))?.suggestion).toContain(path.join(root, "docs"));
    expect(leaks.find((f) => f.path?.endsWith("explore.mjs"))?.suggestion).toContain(path.join(root, "scripts"));
    expect(report.ok).toBe(false);
  });

  it("detects plaintext credentials inside workspace scripts", async () => {
    const root = tmp("secret");
    buildWorkspaceDirs(root);
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");
    writeFileSync(path.join(root, "scripts", "login.mjs"), "const password = 'S73cZ#mH';\n");

    const report = await runDoctor(buildConfig(root), { toolRoot: tmp("secret-tool") });

    const secrets = report.findings.filter((finding) => finding.code === "plaintext-secret");
    expect(secrets).toHaveLength(1);
    expect(secrets[0]?.severity).toBe("error");
    expect(secrets[0]?.path).toBe(path.join(root, "scripts", "login.mjs"));
    // The report names the credential without echoing it.
    expect(secrets[0]?.message).toContain("password");
    expect(secrets[0]?.message).not.toContain("S73cZ#mH");
    expect(report.ok).toBe(false);
  });

  it("skips the workspace when scanning a tool checkout that contains it", async () => {
    const toolRoot = tmp("nested");
    const root = path.join(toolRoot, "test-output", "fit-ticket");
    mkdirSync(root, { recursive: true });
    buildWorkspaceDirs(root);
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");
    // Legitimately references the target — it lives in the workspace.
    writeFileSync(path.join(root, "scripts", "explore.mjs"), `const baseUrl = '${BASE_URL}';\n`);

    const report = await runDoctor(buildConfig(root), { toolRoot });

    expect(codes(report.findings)).toEqual([]);
  });

  it("flags output directories that escape the workspace", async () => {
    const root = tmp("escape");
    buildWorkspaceDirs(root);
    const config = buildConfig(root);
    const escaped = {
      ...config,
      artifacts: { ...config.artifacts, directory: path.join(tmpdir(), "outside-artifacts") },
    } as ProjectConfig;

    const report = await runDoctor(escaped, { toolRoot: tmp("escape-tool") });

    expect(codes(report.findings)).toContain("workspace-escape");
    expect(report.ok).toBe(false);
  });

  it("flags an artifacts directory that is a symbolic link out of the workspace", async () => {
    const root = tmp("symlink");
    buildWorkspaceDirs(root);
    const outside = tmp("symlink-outside");
    rmSync(path.join(root, "artifacts"), { recursive: true, force: true });
    symlinkSync(outside, path.join(root, "artifacts"), "dir");
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");

    const report = await runDoctor(buildConfig(root), { toolRoot: tmp("symlink-tool") });

    expect(codes(report.findings)).toContain("workspace-escape");
    expect(report.ok).toBe(false);
  });

  it("flags a report tree that has an index but no module report despite runs", async () => {
    // The failure this catches is a green run that delivered nothing: index.html
    // exists, every scenario passed, and the tree carries no evidence at all.
    const root = tmp("empty-tree");
    buildWorkspaceDirs(root);
    mkdirSync(path.join(root, "artifacts", "runs", "run_abc"), { recursive: true });
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");

    const report = await runDoctor(buildConfig(root), { toolRoot: tmp("empty-tree-tool") });

    expect(codes(report.findings)).toContain("report-tree-empty");
    expect(report.ok).toBe(false);
  });

  it("accepts a report tree that contains a module report", async () => {
    const root = tmp("full-tree");
    buildWorkspaceDirs(root);
    mkdirSync(path.join(root, "artifacts", "runs", "run_abc"), { recursive: true });
    mkdirSync(path.join(root, "report", "orders"), { recursive: true });
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");
    writeFileSync(path.join(root, "report", "orders", "module.html"), "<html></html>");

    const report = await runDoctor(buildConfig(root), { toolRoot: tmp("full-tree-tool") });

    expect(codes(report.findings)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("does not treat a loopback target host as a leak needle", async () => {
    // `localhost:3000` appears in this tool's own defaults and in most web
    // projects, so matching on it reports tool source as a leaked artifact.
    const root = tmp("loopback");
    buildWorkspaceDirs(root);
    writeFileSync(path.join(root, "report", "index.html"), "<html></html>");
    const toolRoot = tmp("loopback-tool");
    writeFileSync(path.join(toolRoot, "cli.ts"), `const defaultBaseUrl = 'http://localhost:3000';\n`);

    const config = buildConfig(root);
    const loopback = { ...config, target: { ...config.target, baseUrl: "http://localhost:3000" } } as ProjectConfig;
    const report = await runDoctor(loopback, { toolRoot });

    expect(codes(report.findings)).not.toContain("leaked-file");
  });
});
