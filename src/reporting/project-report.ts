import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectConfig } from "../core/config.js";
import type {
  ArtifactRef,
  Finding,
  Inventory,
  InventoryNode,
  RunPlan,
  RunResult,
  ScenarioResult,
  StepResult,
  TestScenario,
} from "../core/types.js";

const STATUS_LABEL: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  blocked: "已阻断",
  error: "错误",
  skipped: "跳过",
  cancelled: "已取消",
  queued: "排队中",
  running: "运行中",
};

const STATUS_COLOR: Record<string, string> = {
  passed: "#1a7f37",
  failed: "#cf222e",
  blocked: "#bf8700",
  error: "#cf222e",
  skipped: "#6e7781",
  cancelled: "#6e7781",
  queued: "#6e7781",
  running: "#0969da",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "") || "module"
  );
}

/**
 * Resolve the top-level `test-<project>` report directory.
 * Defaults to a `test-<slug>` directory beside the artifact workspace; can be
 * overridden via `config.report.projectDirectory` (relative to the config dir).
 */
export function resolveProjectReportDir(config: ProjectConfig): string {
  const override = config.report?.projectDirectory;
  if (override && override.trim().length > 0) {
    return path.resolve(config.configDir, override);
  }
  const base = path.dirname(config.artifacts.directory);
  return path.resolve(base, `test-${slugify(config.project.name)}`);
}

export interface ProjectReportInput {
  config: ProjectConfig;
  inventory: Inventory;
  scenarios: TestScenario[];
  runResult?: RunResult | undefined;
  plan?: RunPlan | undefined;
}

export interface ModuleReportInfo {
  moduleId: string;
  moduleName: string;
  dir: string;
  htmlPath: string;
  scenarioCount: number;
}

export interface ProjectReportResult {
  rootDir: string;
  indexHtmlPath: string;
  modules: ModuleReportInfo[];
  runId?: string | undefined;
}

interface ModuleMeta {
  node: InventoryNode;
  routeIds: string[];
  apiIds: string[];
  pageIds: string[];
  scenarioCount: number;
}

const PAGE_STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; color: #1f2328; line-height: 1.55; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 22px 64px; }
  header h1 { font-size: 24px; margin: 0 0 6px; }
  .meta { color: #57606a; font-size: 13px; margin-bottom: 18px; }
  .summary { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 26px; }
  .stat { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px; padding: 10px 14px; min-width: 92px; }
  .stat b { display: block; font-size: 20px; }
  .stat span { color: #57606a; font-size: 12px; }
  .module { border: 1px solid #d0d7de; border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
  .module h2 { margin: 0 0 6px; font-size: 18px; }
  .module .desc { color: #57606a; font-size: 13px; }
  .chips { margin: 8px 0; }
  .chip { display: inline-block; background: #eef1f4; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin: 2px 4px 2px 0; }
  .links a { color: #0969da; text-decoration: none; font-size: 13px; }
  .links a:hover { text-decoration: underline; }
  .badge { display: inline-block; color: #fff; border-radius: 999px; padding: 1px 10px; font-size: 12px; font-weight: 600; }
  .scenario { border-top: 1px solid #eaeef2; padding: 14px 0; }
  .scenario h3 { margin: 0 0 4px; font-size: 15px; }
  ol.steps { margin: 8px 0; padding-left: 22px; }
  ol.steps li { margin-bottom: 12px; }
  .step-action { font-weight: 600; }
  .assert { color: #57606a; font-size: 12px; margin-left: 6px; }
  img.shot { display: block; max-width: 100%; border: 1px solid #d0d7de; border-radius: 6px; margin: 8px 0; }
  .problem { background: #fff8f0; border: 1px solid #f0d8b0; border-radius: 8px; padding: 10px 14px; margin-top: 8px; }
  .problem pre { white-space: pre-wrap; font-size: 12px; margin: 6px 0 0; }
  h2.section { margin-top: 30px; font-size: 18px; }
`;

function moduleDirName(modulesOut: ModuleReportInfo[], node: InventoryNode): string {
  let name = slugify(node.name || node.id);
  if (modulesOut.some((m) => path.basename(m.dir) === name)) {
    name = `${name}-${node.id.slice(0, 6)}`;
  }
  return name;
}

function scenarioCatalogMap(scenarios: TestScenario[]): Map<string, TestScenario> {
  const map = new Map<string, TestScenario>();
  for (const scenario of scenarios) map.set(scenario.id, scenario);
  return map;
}

function moduleMetas(inventory: Inventory, scenarios: TestScenario[]): Map<string, ModuleMeta> {
  const map = new Map<string, ModuleMeta>();
  for (const node of inventory.nodes) {
    if (node.kind !== "module") continue;
    const routeIds = (node as { routeIds?: string[] }).routeIds ?? [];
    const apiIds = (node as { apiIds?: string[] }).apiIds ?? [];
    const pageIds = inventory.nodes
      .filter((n) => n.kind === "page" && (n as { moduleId?: string }).moduleId === node.id)
      .map((n) => n.id);
    const scenarioCount = scenarios.filter((s) => s.moduleIds[0] === node.id).length;
    map.set(node.id, { node, routeIds, apiIds, pageIds, scenarioCount });
  }
  return map;
}

function statusBadge(status: string): string {
  const color = STATUS_COLOR[status] ?? "#6e7781";
  return `<span class="badge" style="background:${color}">${escapeHtml(STATUS_LABEL[status] ?? status)}</span>`;
}

function stepScreenshotHtml(step: StepResult, screenshotMap: Map<string, string>): string {
  const shot = step.artifacts.find((a) => a.kind === "screenshot");
  if (!shot) return `<p class="assert">（无截图）</p>`;
  const rel = screenshotMap.get(shot.path);
  if (!rel) return `<p class="assert">（无截图）</p>`;
  return `<img class="shot" src="./${encodeURI(rel)}" alt="步骤截图" />`;
}

function scenarioHtml(
  scenarioResult: ScenarioResult,
  catalogScenario: TestScenario | undefined,
  screenshotMap: Map<string, string>,
  findings: Finding[],
): string {
  const name = catalogScenario?.name ?? scenarioResult.scenarioId;
  const description = catalogScenario?.description ?? "（无业务描述）";
  const catalogSteps = catalogScenario?.steps ?? [];
  const steps = scenarioResult.steps
    .map((step, index) => {
      const catalogStep = catalogSteps[index];
      const target = (catalogStep as { target?: string } | undefined)?.target;
      const value = (catalogStep as { value?: string } | undefined)?.value;
      const assertionCount = Array.isArray(step.assertions) ? step.assertions.length : 0;
      const failedAssertions = (step.assertions ?? [])
        .filter((a) => a.status === "failed")
        .map((a) => escapeHtml(a.message ?? a.id ?? "断言失败"))
        .join("；");
      const assertionText =
        assertionCount > 0
          ? `<span class="assert">${assertionCount} 项断言${failedAssertions ? `（失败：${failedAssertions}）` : ""}</span>`
          : "";
      const targetText = [target, value].filter(Boolean).map((t) => escapeHtml(String(t))).join(" / ");
      return `<li>
        <div><span class="step-action">步骤 ${index + 1}：${escapeHtml(step.action)}</span>${targetText ? ` <span class="assert">${targetText}</span>` : ""} ${assertionText}</div>
        ${stepScreenshotHtml(step, screenshotMap)}
      </li>`;
    })
    .join("");

  const scenarioFindings = findings.filter((f) => scenarioResult.findingIds.includes(f.id));
  const problemHtml =
    scenarioResult.status === "passed"
      ? ""
      : `<div class="problem"><b>结果：${escapeHtml(STATUS_LABEL[scenarioResult.status] ?? scenarioResult.status)}</b>${
          scenarioResult.error ? `<pre>${escapeHtml(scenarioResult.error.message)}</pre>` : ""
        }${scenarioFindings.map((f) => `<pre>${escapeHtml(`${f.title}: ${f.summary}${f.details ? ` — ${f.details}` : ""}`)}</pre>`).join("")}</div>`;

  return `<div class="scenario">
    <h3>${escapeHtml(name)} ${statusBadge(scenarioResult.status)} <span class="assert">role: ${escapeHtml(scenarioResult.role)}</span></h3>
    <div class="desc">${escapeHtml(description)}</div>
    <div class="chips"><span class="chip">步骤数 ${scenarioResult.steps.length}</span></div>
    <ol class="steps">${steps}</ol>
    ${problemHtml}
  </div>`;
}

function moduleHtml(
  node: InventoryNode,
  meta: ModuleMeta,
  scenarioResults: ScenarioResult[],
  catalog: Map<string, TestScenario>,
  screenshotMap: Map<string, string>,
  findings: Finding[],
): string {
  const description = (node as { description?: string }).description ?? "（无模块描述）";
  const sourcePaths = ((node as { sourcePaths?: string[] }).sourcePaths ?? []).join(", ") || "（未标注）";
  const chips = [
    `路由 ${meta.routeIds.length}`,
    `页面 ${meta.pageIds.length}`,
    `接口 ${meta.apiIds.length}`,
    `场景 ${meta.scenarioCount}`,
  ]
    .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
    .join("");

  const scenarioBlocks = scenarioResults
    .map((sr) => scenarioHtml(sr, catalog.get(sr.scenarioId), screenshotMap, findings))
    .join("");

  const problems = scenarioResults.filter((sr) => sr.status !== "passed");
  const problemSection = problems.length
    ? `<h2 class="section">发现的问题（${problems.length}）</h2>${problems
        .map((sr) => {
          const catalogEntry = catalog.get(sr.scenarioId);
          const name = catalogEntry?.name ?? sr.scenarioId;
          const scFindings = findings.filter((f) => sr.findingIds.includes(f.id));
          return `<div class="problem"><b>${escapeHtml(name)} ${statusBadge(sr.status)}</b>${
            sr.error ? `<pre>${escapeHtml(sr.error.message)}</pre>` : ""
          }${scFindings.map((f) => `<pre>${escapeHtml(`${f.title}: ${f.summary}${f.details ? ` — ${f.details}` : ""}`)}</pre>`).join("")}</div>`;
        })
        .join("")}`
    : `<h2 class="section">发现的问题</h2><p class="desc">本次执行未发现阻断或失败问题。</p>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>测试业务模块 - ${escapeHtml(node.name)}</title><style>${PAGE_STYLE}</style></head>
<body><div class="wrap">
  <header><h1>测试业务模块：${escapeHtml(node.name)}</h1>
    <div class="meta">模块描述：${escapeHtml(description)}</div>
    <div class="chips">${chips}</div>
    <div class="desc">源码范围：${escapeHtml(sourcePaths)}</div>
  </header>
  <h2 class="section">测试场景（${scenarioResults.length}）</h2>
  ${scenarioBlocks || '<p class="desc">该模块本次没有可执行场景。</p>'}
  ${problemSection}
  <p class="meta"><a href="../index.html">← 返回全局业务模块分析</a></p>
</div></body></html>`;
}

function indexHtml(
  config: ProjectConfig,
  inventory: Inventory,
  modules: InventoryNode[],
  metas: Map<string, ModuleMeta>,
  moduleReports: ModuleReportInfo[],
  runResult: RunResult | undefined,
): string {
  const coverage = inventory.coverage;
  const moduleCards = modules
    .map((node) => {
      const meta = metas.get(node.id);
      if (!meta) return "";
      const report = moduleReports.find((m) => m.moduleId === node.id);
      const rel = report ? `./${path.basename(report.dir)}/module.html` : undefined;
      const description = (node as { description?: string }).description ?? "（无模块描述）";
      const sourcePaths = ((node as { sourcePaths?: string[] }).sourcePaths ?? []).join(", ") || "（未标注）";
      const chips = [
        `路由 ${meta.routeIds.length}`,
        `页面 ${meta.pageIds.length}`,
        `接口 ${meta.apiIds.length}`,
        `场景 ${meta.scenarioCount}`,
      ]
        .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
        .join("");
      const link = rel
        ? `<div class="links"><a href="${encodeURI(rel)}">查看模块测试报告 →</a></div>`
        : `<div class="links"><span class="desc">（尚未执行测试）</span></div>`;
      return `<div class="module">
        <h2>${escapeHtml(node.name)}</h2>
        <div class="desc">${escapeHtml(description)}</div>
        <div class="chips">${chips}</div>
        <div class="desc">源码范围：${escapeHtml(sourcePaths)}</div>
        ${link}
      </div>`;
    })
    .join("");

  const runSummary = runResult
    ? `<div class="meta">最近一次执行：${escapeHtml(runResult.id)} · 状态 ${escapeHtml(STATUS_LABEL[runResult.status] ?? runResult.status)} · 场景 ${runResult.scenarios.length}</div>`
    : `<div class="meta">尚未执行测试，下面仅展示静态梳理出的业务模块。</div>`;

  const stats = [
    { b: modules.length, s: "业务模块" },
    { b: coverage?.routes?.discovered ?? "—", s: "路由" },
    { b: coverage?.pages?.discovered ?? "—", s: "页面" },
    { b: coverage?.apis?.discovered ?? "—", s: "接口" },
    { b: coverage?.scenarios?.discovered ?? "—", s: "场景" },
  ]
    .map((x) => `<div class="stat"><b>${escapeHtml(String(x.b))}</b><span>${escapeHtml(x.s)}</span></div>`)
    .join("");

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>业务模块全局分析 - ${escapeHtml(config.project.name)}</title><style>${PAGE_STYLE}</style></head>
<body><div class="wrap">
  <header><h1>业务模块全局分析：${escapeHtml(config.project.name)}</h1>
    <div class="meta">目标：${escapeHtml(config.target.baseUrl || config.target.rootDir)} · 生成时间：${escapeHtml(new Date().toISOString())}</div>
    ${runSummary}
  </header>
  <div class="summary">${stats}</div>
  <h2 class="section">全部业务模块（${modules.length}）</h2>
  ${moduleCards || '<p class="desc">未发现业务模块。</p>'}
</div></body></html>`;
}

/**
 * Build the `test-<project>` report tree:
 *  - `index.html` — global business-module analysis (the first document)
 *  - `<module>/module.html` — one subdirectory per tested module, with inline
 *    step screenshots copied next to the report
 */
export async function writeProjectReport(input: ProjectReportInput): Promise<ProjectReportResult> {
  const { config, inventory, scenarios, runResult, plan } = input;
  void plan;
  const rootDir = resolveProjectReportDir(config);
  await mkdir(rootDir, { recursive: true });

  const modules = inventory.nodes.filter((node) => node.kind === "module");
  const metas = moduleMetas(inventory, scenarios);
  const catalog = scenarioCatalogMap(scenarios);

  // scenarioId -> moduleId
  const scenarioModule = new Map<string, string>();
  for (const scenario of scenarios) {
    const moduleId = scenario.moduleIds[0];
    if (moduleId) scenarioModule.set(scenario.id, moduleId);
  }

  // Group run scenarios by module.
  const moduleScenarioResults = new Map<string, ScenarioResult[]>();
  if (runResult) {
    for (const sr of runResult.scenarios) {
      const moduleId = scenarioModule.get(sr.scenarioId);
      if (!moduleId) continue;
      const list = moduleScenarioResults.get(moduleId) ?? [];
      list.push(sr);
      moduleScenarioResults.set(moduleId, list);
    }
  }

  const modulesOut: ModuleReportInfo[] = [];
  for (const node of modules) {
    const meta = metas.get(node.id);
    if (!meta) continue;
    const scenarioResults = moduleScenarioResults.get(node.id) ?? [];
    // Module subdirectories are created only after tests execute; a module
    // with no scenario results in this run gets no subdirectory.
    if (scenarioResults.length === 0) continue;
    const dirName = moduleDirName(modulesOut, node);
    const modDir = path.join(rootDir, dirName);
    await mkdir(modDir, { recursive: true });

    // Collect and copy screenshots into the module directory.
    const screenshotMap = new Map<string, string>();
    let shotCounter = 0;
    const collect = (artifacts: ArtifactRef[]) => {
      for (const a of artifacts) {
        if (a.kind !== "screenshot") continue;
        if (screenshotMap.has(a.path)) continue;
        shotCounter += 1;
        screenshotMap.set(a.path, `screenshot-${String(shotCounter).padStart(3, "0")}.png`);
      }
    };
    for (const sr of scenarioResults) {
      collect(sr.artifacts);
      for (const step of sr.steps) collect(step.artifacts);
    }
    for (const [abs, rel] of screenshotMap) {
      try {
        await copyFile(abs, path.join(modDir, rel));
      } catch {
        // best-effort; missing screenshot artifacts are skipped
      }
    }

    const html = moduleHtml(node, meta, scenarioResults, catalog, screenshotMap, runResult?.findings ?? []);
    const htmlPath = path.join(modDir, "module.html");
    await writeFile(htmlPath, html, "utf8");
    modulesOut.push({
      moduleId: node.id,
      moduleName: node.name,
      dir: modDir,
      htmlPath,
      scenarioCount: scenarioResults.length,
    });
  }

  const indexHtmlPath = path.join(rootDir, "index.html");
  await writeFile(
    indexHtmlPath,
    indexHtml(config, inventory, modules, metas, modulesOut, runResult),
    "utf8",
  );

  return { rootDir, indexHtmlPath, modules: modulesOut, runId: runResult?.id };
}
