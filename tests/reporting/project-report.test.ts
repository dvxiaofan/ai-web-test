import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type { ProjectConfig } from "../../src/core/config.js";
import type { Inventory, RunResult, TestScenario } from "../../src/core/types.js";
import { writeProjectReport, resolveProjectReportDir } from "../../src/reporting/project-report.js";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000001e221bc330000000049454e44ae426082",
  "hex",
);

function tmp(name: string): string {
  const dir = path.join(tmpdir(), `awt-project-report-${process.pid}-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePng(dir: string, name: string): string {
  const p = path.join(dir, name);
  writeFileSync(p, PNG);
  return p;
}

function buildConfig(artifactsDir: string, reportDir?: string): ProjectConfig {
  return {
    schemaVersion: 1,
    configDir: artifactsDir,
    project: { id: "p1", name: "sample shop" },
    target: { rootDir: "/tmp/app", baseUrl: "http://localhost:4178" },
    artifacts: { directory: artifactsDir },
    source: { include: ["src"], exclude: [], maxFiles: 1, maxFileSizeBytes: 1 },
    runtime: { enabled: true, headless: true, profiles: [] },
    roles: [],
    auth: { roles: [] },
    policy: {
      maxRisk: "read",
      allowedHosts: ["localhost"],
      allowExternalOrigins: false,
      allowSecretPersistence: true,
      confirmationRequired: true,
      destructiveActionAllowlist: [],
    },
    ai: { providers: [] },
    presets: {},
    report: { projectDirectory: reportDir },
  } as unknown as ProjectConfig;
}

function buildInventory(): Inventory {
  return {
    schemaVersion: 1,
    project: { id: "p1", name: "sample shop", rootDir: "/tmp/app" },
    nodes: [
      { id: "m-home", kind: "module", name: "首页", sourcePaths: ["src/home"], routeIds: ["r-home"], apiIds: [] },
      { id: "m-admin", kind: "module", name: "管理后台", sourcePaths: ["src/admin"], routeIds: ["r-admin"], apiIds: ["a-user"] },
      { id: "r-home", kind: "route", name: "Home", method: "GET", path: "/", moduleId: "m-home" },
      { id: "r-admin", kind: "route", name: "Admin", method: "GET", path: "/admin", moduleId: "m-admin" },
      { id: "a-user", kind: "api", name: "User API", method: "GET", path: "/api/user", moduleId: "m-admin" },
    ],
    edges: [],
    coverage: {
      routes: { discovered: 2, covered: 1 },
      pages: { discovered: 2, covered: 1 },
      apis: { discovered: 1, covered: 0 },
      scenarios: { discovered: 2, approved: 2, executed: 2, passed: 1, blocked: 0, failed: 1 },
    },
  } as unknown as Inventory;
}

function buildScenarios(): TestScenario[] {
  return [
    { id: "s-home", name: "首页冒烟", description: "验证首页可访问", moduleIds: ["m-home"], routeIds: ["r-home"], operationIds: [], roleIds: [], steps: [], risk: "read" },
    { id: "s-admin", name: "后台冒烟", description: "验证后台可访问", moduleIds: ["m-admin"], routeIds: ["r-admin"], operationIds: ["a-user"], roleIds: [], steps: [], risk: "read" },
  ] as unknown as TestScenario[];
}

function buildRunResult(shotHome: string, shotAdmin: string): RunResult {
  return {
    id: "run_demo",
    planId: "approved-plan_x",
    status: "completed",
    startedAt: "",
    endedAt: "",
    scenarios: [
      {
        scenarioId: "s-home",
        role: "guest",
        status: "passed",
        steps: [
          { stepId: "st1", action: "navigate", status: "passed", assertions: [{ id: "a1", status: "passed", message: "ok" }], artifacts: [{ kind: "screenshot", path: shotHome, mimeType: "image/png" }] },
        ],
        artifacts: [],
        findingIds: [],
        error: undefined,
      },
      {
        scenarioId: "s-admin",
        role: "admin",
        status: "failed",
        steps: [
          { stepId: "st2", action: "click", status: "failed", assertions: [{ id: "a2", status: "failed", message: "button missing" }], artifacts: [{ kind: "screenshot", path: shotAdmin, mimeType: "image/png" }] },
        ],
        artifacts: [],
        findingIds: ["f1"],
        error: { name: "AssertionError", message: "button missing" },
      },
    ],
    findings: [{ id: "f1", title: "后台按钮缺失", category: "ui", classification: "bug", severity: "major", summary: "登录后未渲染管理入口", details: "见截图", evidence: [] }],
    coverage: { routes: { discovered: 2, covered: 1 }, pages: { discovered: 2, covered: 1 }, apis: { discovered: 1, covered: 0 }, scenarios: { discovered: 2, approved: 2, executed: 2, passed: 1, blocked: 0, failed: 1 } },
  } as unknown as RunResult;
}

describe("project-report", () => {
  it("resolves the default report/ directory beside the artifacts dir", () => {
    const artifactsDir = tmp("artifacts");
    const config = buildConfig(artifactsDir);
    const resolved = resolveProjectReportDir(config);
    expect(resolved).toBe(path.resolve(path.dirname(artifactsDir), "report"));
  });

  it("honors an explicit report.projectDirectory override (relative to config dir)", () => {
    const artifactsDir = tmp("artifacts");
    const config = buildConfig(artifactsDir, "custom-report");
    const resolved = resolveProjectReportDir(config);
    expect(resolved).toBe(path.resolve(artifactsDir, "custom-report"));
  });

  it("writes a global analysis index.html plus one subdirectory per tested module with inline screenshots", async () => {
    const artifactsDir = tmp("artifacts");
    const shotsDir = tmp("shots");
    const shotHome = writePng(shotsDir, "home.png");
    const shotAdmin = writePng(shotsDir, "admin.png");
    const config = buildConfig(artifactsDir);
    const inventory = buildInventory();
    const scenarios = buildScenarios();
    const runResult = buildRunResult(shotHome, shotAdmin);

    const result = await writeProjectReport({ config, inventory, scenarios, runResult });

    // Global analysis document (the first document).
    expect(existsSync(result.indexHtmlPath)).toBe(true);
    const index = readFileSync(result.indexHtmlPath, "utf8");
    expect(index).toContain("业务模块全局分析");
    expect(index).toContain("首页");
    expect(index).toContain("管理后台");

    // One subdirectory per tested module.
    expect(result.modules).toHaveLength(2);
    const homeModule = result.modules.find((m) => m.moduleName === "首页");
    const adminModule = result.modules.find((m) => m.moduleName === "管理后台");
    expect(homeModule).toBeDefined();
    expect(adminModule).toBeDefined();

    // Module HTML references the copied screenshot and the problem section.
    const homeHtml = readFileSync(homeModule!.htmlPath, "utf8");
    expect(homeHtml).toContain("测试业务模块");
    expect(homeHtml).toContain("<img");
    expect(existsSync(path.join(homeModule!.dir, "screenshot-001.png"))).toBe(true);

    const adminHtml = readFileSync(adminModule!.htmlPath, "utf8");
    expect(adminHtml).toContain("发现的问题");
    expect(adminHtml).toContain("后台按钮缺失");
    expect(adminHtml).toContain("<img");
  });

  it("produces only the global analysis document when no run result is provided", async () => {
    const artifactsDir = tmp("artifacts");
    const config = buildConfig(artifactsDir);
    const result = await writeProjectReport({ config, inventory: buildInventory(), scenarios: buildScenarios() });
    expect(existsSync(result.indexHtmlPath)).toBe(true);
    expect(result.modules).toHaveLength(0);
  });

  it("keeps executed scenarios that belong to no module instead of dropping them", async () => {
    // A run whose scenarios carry no moduleIds used to produce index.html and
    // nothing else: every step, screenshot, and finding silently discarded
    // while the run still reported success.
    const artifactsDir = tmp("artifacts");
    const shotsDir = tmp("shots-ungrouped");
    const shot = writePng(shotsDir, "loose.png");
    const config = buildConfig(artifactsDir);
    const scenarios = buildScenarios().map((scenario) => ({ ...scenario, moduleIds: [] }));
    const runResult = buildRunResult(shot, shot);

    const result = await writeProjectReport({ config, inventory: buildInventory(), scenarios, runResult });

    const ungrouped = result.modules.find((module) => module.moduleName === "未归类场景");
    expect(ungrouped).toBeDefined();
    expect(ungrouped!.scenarioCount).toBe(2);

    const html = readFileSync(ungrouped!.htmlPath, "utf8");
    expect(html).toContain("<img");
    expect(html).toContain("后台按钮缺失");
    expect(existsSync(path.join(ungrouped!.dir, "screenshot-001.png"))).toBe(true);
  });
});
