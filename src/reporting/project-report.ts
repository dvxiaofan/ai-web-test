import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectConfig } from "../core/config.js";
import type {
  ArtifactRef,
  Finding,
  Inventory,
  InventoryNode,
  ProjectOverview,
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
  /** Optional project-level narrative (overview.json); sections degrade when absent. */
  overview?: ProjectOverview | undefined;
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
  table.grid { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
  table.grid th, table.grid td { border: 1px solid #d0d7de; padding: 7px 9px; text-align: left; vertical-align: top; }
  table.grid th { background: #f6f8fa; font-weight: 600; white-space: nowrap; }
  table.grid td.num { text-align: right; white-space: nowrap; }
  table.grid code { font-size: 12px; background: #f6f8fa; padding: 1px 4px; border-radius: 4px; }
  .facts { border: 1px solid #d0d7de; border-radius: 10px; padding: 14px 18px; background: #fbfcfd; }
  .facts dl { display: grid; grid-template-columns: 96px 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
  .facts dt { color: #57606a; }
  .facts dd { margin: 0; }
  ul.plain { margin: 6px 0; padding-left: 20px; font-size: 13px; }
  ul.plain li { margin-bottom: 4px; }
  .todo { color: #57606a; }
  .done { color: #1a7f37; }
`;

const SEVERITY_LABEL: Record<string, string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
  info: "提示",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#a40e26",
  high: "#cf222e",
  medium: "#bf8700",
  low: "#0969da",
  info: "#6e7781",
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const FINDING_STATUS_LABEL: Record<string, string> = {
  open: "待处理",
  confirmed: "已确认",
  resolved: "已修复",
  dismissed: "已忽略",
  duplicate: "重复",
};

const PRIORITY_LABEL: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

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

/** Read `config.metadata.overview` (static project facts authored by hand). */
function readOverviewFacts(config: ProjectConfig): {
  intro?: string;
  techStack?: string;
  conventions: string[];
  businessSystems: string[];
  accounts: Array<{ role?: string; note?: string }>;
} {
  const raw = (config.metadata as { overview?: unknown } | undefined)?.overview;
  const record = (raw ?? {}) as Record<string, unknown>;
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const accounts = Array.isArray(record.accounts)
    ? (record.accounts as unknown[])
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => ({
          ...(typeof item.role === "string" ? { role: item.role } : {}),
          ...(typeof item.note === "string" ? { note: item.note } : {}),
        }))
    : [];
  return {
    ...(typeof record.intro === "string" ? { intro: record.intro } : {}),
    ...(typeof record.techStack === "string" ? { techStack: record.techStack } : {}),
    conventions: stringList(record.conventions),
    businessSystems: stringList(record.businessSystems),
    accounts,
  };
}

/** Section 2 — static project facts; hidden entirely when nothing is configured. */
function renderProjectFacts(config: ProjectConfig): string {
  const facts = readOverviewFacts(config);
  const rows: string[] = [];
  if (facts.intro) rows.push(`<dt>系统简介</dt><dd>${escapeHtml(facts.intro)}</dd>`);
  if (facts.techStack) rows.push(`<dt>技术栈</dt><dd>${escapeHtml(facts.techStack)}</dd>`);
  if (facts.businessSystems.length) {
    rows.push(
      `<dt>业务系统</dt><dd>${facts.businessSystems
        .map((s) => `<span class="chip">${escapeHtml(s)}</span>`)
        .join("")}</dd>`,
    );
  }
  if (facts.accounts.length) {
    rows.push(
      `<dt>测试账号</dt><dd>${facts.accounts
        .map((a) => escapeHtml([a.role, a.note].filter(Boolean).join("：")))
        .join("<br />")}</dd>`,
    );
  }
  if (facts.conventions.length) {
    rows.push(
      `<dt>测试约定</dt><dd><ul class="plain">${facts.conventions
        .map((c) => `<li>${escapeHtml(c)}</li>`)
        .join("")}</ul></dd>`,
    );
  }
  if (!rows.length) return "";
  return `<h2 class="section">系统简介与测试约定</h2>
  <div class="facts"><dl>${rows.join("")}</dl></div>`;
}

/** Section 4 — module detail table (replaces the old card list). */
function renderModuleTable(
  inventory: Inventory,
  modules: InventoryNode[],
  metas: Map<string, ModuleMeta>,
  moduleReports: ModuleReportInfo[],
  moduleStatus: Map<string, string>,
): string {
  if (!modules.length) return '<p class="desc">未发现业务模块。</p>';
  const nodeById = new Map(inventory.nodes.map((node) => [node.id, node]));
  const routeText = (ids: string[]): string => {
    const paths = ids
      .map((id) => (nodeById.get(id) as { path?: string; name?: string } | undefined))
      .map((node) => node?.path ?? node?.name)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!paths.length) return "—";
    const shown = paths.slice(0, 4).map((p) => `<code>${escapeHtml(p)}</code>`).join(" ");
    return paths.length > 4 ? `${shown} <span class="desc">等 ${paths.length} 条</span>` : shown;
  };

  const rows = modules
    .map((node) => {
      const meta = metas.get(node.id);
      if (!meta) return "";
      const report = moduleReports.find((m) => m.moduleId === node.id);
      const rel = report ? `./${path.basename(report.dir)}/module.html` : undefined;
      const description = (node as { description?: string }).description ?? "—";
      const status = moduleStatus.get(node.id);
      const statusCell = status ? statusBadge(status) : '<span class="desc">未执行</span>';
      const linkCell = rel
        ? `<a href="${encodeURI(rel)}">查看报告 →</a>`
        : '<span class="desc">—</span>';
      return `<tr>
        <td><b>${escapeHtml(node.name)}</b></td>
        <td>${escapeHtml(description)}</td>
        <td>${routeText(meta.routeIds)}</td>
        <td class="num">${meta.apiIds.length}</td>
        <td class="num">${meta.scenarioCount}</td>
        <td>${statusCell}</td>
        <td>${linkCell}</td>
      </tr>`;
    })
    .join("");

  return `<table class="grid">
    <thead><tr>
      <th>业务模块</th><th>说明</th><th>主要路由</th><th>接口</th><th>场景</th><th>执行状态</th><th>模块报告</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Section 5 — defect pool aggregated from inventory + run findings. */
function renderFindingPool(
  findings: Finding[],
  moduleNameById: Map<string, string>,
  scenarioNameById: Map<string, string>,
): string {
  if (!findings.length) {
    return '<h2 class="section">缺陷池</h2><p class="desc">当前未发现缺陷。</p>';
  }
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
  const counts = new Map<string, number>();
  for (const finding of sorted) {
    const severity = finding.severity ?? "info";
    counts.set(severity, (counts.get(severity) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort((a, b) => (SEVERITY_ORDER[a[0]] ?? 9) - (SEVERITY_ORDER[b[0]] ?? 9))
    .map(
      ([severity, count]) =>
        `<span class="chip">${escapeHtml(SEVERITY_LABEL[severity] ?? severity)} ${count}</span>`,
    )
    .join("");

  const rows = sorted
    .map((finding) => {
      const severity = finding.severity ?? "info";
      const status = finding.status ?? "open";
      const color = SEVERITY_COLOR[severity] ?? "#6e7781";
      const related = (finding.relatedIds ?? [])
        .map((id) => moduleNameById.get(id) ?? scenarioNameById.get(id))
        .filter((value): value is string => Boolean(value));
      const relatedText = related.length ? escapeHtml([...new Set(related)].join("、")) : "—";
      const detail = [finding.summary, finding.details].filter(Boolean).join(" — ");
      return `<tr>
        <td><span class="badge" style="background:${color}">${escapeHtml(
          SEVERITY_LABEL[severity] ?? severity,
        )}</span></td>
        <td><b>${escapeHtml(finding.title ?? finding.id)}</b></td>
        <td>${escapeHtml(detail || "—")}</td>
        <td>${relatedText}</td>
        <td>${escapeHtml(FINDING_STATUS_LABEL[status] ?? status)}</td>
      </tr>`;
    })
    .join("");

  return `<h2 class="section">缺陷池（${sorted.length}）</h2>
  <div class="chips">${summary}</div>
  <table class="grid">
    <thead><tr><th>严重度</th><th>标题</th><th>说明</th><th>关联</th><th>状态</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Section 6 — cross-module end-to-end flows. */
function renderE2eFlows(overview: ProjectOverview | undefined): string {
  const flows = overview?.e2eFlows ?? [];
  if (!flows.length) return "";
  const rows = flows
    .map(
      (flow) => `<tr>
      <td><b>${escapeHtml(flow.name)}</b></td>
      <td>${flow.steps.length ? escapeHtml(flow.steps.join(" → ")) : "—"}</td>
      <td>${flow.status === "not-run" ? '<span class="desc">未执行</span>' : statusBadge(flow.status)}</td>
      <td>${escapeHtml(flow.notes ?? "—")}</td>
    </tr>`,
    )
    .join("");
  return `<h2 class="section">全流程（E2E）链路（${flows.length}）</h2>
  <table class="grid">
    <thead><tr><th>链路</th><th>步骤</th><th>结果</th><th>备注</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Section 7 — next steps and acceptance checklist. */
function renderNextSteps(overview: ProjectOverview | undefined): string {
  const nextSteps = overview?.nextSteps ?? [];
  const acceptance = overview?.acceptance ?? [];
  if (!nextSteps.length && !acceptance.length) return "";
  const stepsHtml = nextSteps.length
    ? `<h2 class="section">下一步建议（${nextSteps.length}）</h2>
    <ul class="plain">${nextSteps
      .map(
        (step) =>
          `<li><span class="chip">${escapeHtml(
            PRIORITY_LABEL[step.priority] ?? step.priority,
          )}</span> ${escapeHtml(step.text)}</li>`,
      )
      .join("")}</ul>`
    : "";
  const doneCount = acceptance.filter((item) => item.done).length;
  const acceptanceHtml = acceptance.length
    ? `<h2 class="section">验收清单（${doneCount}/${acceptance.length}）</h2>
    <ul class="plain">${acceptance
      .map(
        (item) =>
          `<li class="${item.done ? "done" : "todo"}">${item.done ? "✓" : "○"} ${escapeHtml(item.item)}${
            item.notes ? ` <span class="desc">（${escapeHtml(item.notes)}）</span>` : ""
          }</li>`,
      )
      .join("")}</ul>`
    : "";
  return `${stepsHtml}${acceptanceHtml}`;
}

/** Section 8 — staged conclusions, newest first. */
function renderConclusions(overview: ProjectOverview | undefined): string {
  const conclusions = overview?.conclusions ?? [];
  if (!conclusions.length) return "";
  const items = [...conclusions]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((c) => `<li><span class="desc">${escapeHtml(c.at)}</span> ${escapeHtml(c.text)}</li>`)
    .join("");
  return `<h2 class="section">阶段结论</h2><ul class="plain">${items}</ul>`;
}

function indexHtml(
  config: ProjectConfig,
  inventory: Inventory,
  modules: InventoryNode[],
  metas: Map<string, ModuleMeta>,
  moduleReports: ModuleReportInfo[],
  runResult: RunResult | undefined,
  scenarios: TestScenario[],
  moduleStatus: Map<string, string>,
  overview: ProjectOverview | undefined,
): string {
  const coverage = inventory.coverage;

  // Defect pool: inventory findings + this run's findings, de-duplicated by id.
  const findingById = new Map<string, Finding>();
  for (const finding of [...(inventory.findings ?? []), ...(runResult?.findings ?? [])]) {
    findingById.set(finding.id, finding);
  }
  const findings = [...findingById.values()];
  const moduleNameById = new Map(modules.map((node) => [node.id, node.name]));
  const scenarioNameById = new Map(scenarios.map((scenario) => [scenario.id, scenario.name]));

  const runSummary = runResult
    ? `<div class="meta">最近一次执行：${escapeHtml(runResult.id)} · 状态 ${escapeHtml(STATUS_LABEL[runResult.status] ?? runResult.status)} · 场景 ${runResult.scenarios.length}</div>`
    : `<div class="meta">尚未执行测试，下面仅展示静态梳理出的业务模块。</div>`;

  const passRate = runResult?.scenarios.length
    ? `${Math.round(
        (runResult.scenarios.filter((s) => s.status === "passed").length / runResult.scenarios.length) * 100,
      )}%`
    : "—";

  const stats = [
    { b: modules.length, s: "业务模块" },
    { b: coverage?.routes?.discovered ?? "—", s: "路由" },
    { b: coverage?.pages?.discovered ?? "—", s: "页面" },
    { b: coverage?.apis?.discovered ?? "—", s: "接口" },
    { b: coverage?.scenarios?.discovered ?? "—", s: "场景" },
    { b: passRate, s: "场景通过率" },
    { b: findings.length, s: "缺陷" },
  ]
    .map((x) => `<div class="stat"><b>${escapeHtml(String(x.b))}</b><span>${escapeHtml(x.s)}</span></div>`)
    .join("");

  const discoveryNote =
    config.target.discovery === "runtime-first"
      ? '<span class="chip">零源码模式（runtime-first）</span>'
      : "";

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>业务模块全局分析 - ${escapeHtml(config.project.name)}</title><style>${PAGE_STYLE}</style></head>
<body><div class="wrap">
  <header><h1>业务模块全局分析：${escapeHtml(config.project.name)}</h1>
    <div class="meta">目标：${escapeHtml(config.target.baseUrl || config.target.rootDir)} · 生成时间：${escapeHtml(new Date().toISOString())} ${discoveryNote}</div>
    ${runSummary}
  </header>
  ${renderProjectFacts(config)}
  <div class="summary">${stats}</div>
  <h2 class="section">全部业务模块（${modules.length}）</h2>
  ${renderModuleTable(inventory, modules, metas, moduleReports, moduleStatus)}
  ${renderFindingPool(findings, moduleNameById, scenarioNameById)}
  ${renderE2eFlows(overview)}
  ${renderNextSteps(overview)}
  ${renderConclusions(overview)}
</div></body></html>`;
}

/**
 * Build the `test-<project>` report tree:
 *  - `index.html` — global business-module analysis (the first document)
 *  - `<module>/module.html` — one subdirectory per tested module, with inline
 *    step screenshots copied next to the report
 */
export async function writeProjectReport(input: ProjectReportInput): Promise<ProjectReportResult> {
  const { config, inventory, scenarios, runResult, plan, overview } = input;
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

  // Aggregate a per-module execution status: worst status wins.
  const moduleStatus = new Map<string, string>();
  for (const [moduleId, results] of moduleScenarioResults) {
    if (!results.length) continue;
    const worst =
      results.find((r) => r.status === "failed" || r.status === "error")?.status ??
      results.find((r) => r.status === "blocked")?.status ??
      (results.every((r) => r.status === "passed") ? "passed" : results[0]!.status);
    moduleStatus.set(moduleId, worst);
  }

  const indexHtmlPath = path.join(rootDir, "index.html");
  await writeFile(
    indexHtmlPath,
    indexHtml(config, inventory, modules, metas, modulesOut, runResult, scenarios, moduleStatus, overview),
    "utf8",
  );

  return { rootDir, indexHtmlPath, modules: modulesOut, runId: runResult?.id };
}
