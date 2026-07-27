import { writeFile } from 'node:fs/promises';
import type { HtmlReportModel, ReportTestResult } from './types.js';
import { zhCN } from './zh-CN.js';

function mdEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function code(value: unknown): string {
  return '`' + mdEscape(value) + '`';
}

function contextOf(result: ReportTestResult): string {
  return [result.module, result.route, result.role].filter(Boolean).join(' · ');
}

function statusLabel(status: string): string {
  switch (status) {
    case 'passed':
      return zhCN.statusPassed;
    case 'failed':
      return zhCN.statusFailed;
    case 'skipped':
      return zhCN.statusSkipped;
    case 'blocked':
      return zhCN.statusBlocked;
    default:
      return mdEscape(status);
  }
}

function coverageRate(dim: { discovered: number; covered: number }): string {
  if (dim.discovered === 0) return '—';
  return `${Math.round((dim.covered / dim.discovered) * 100)}%`;
}

export function renderMarkdownReport(model: HtmlReportModel): string {
  const total =
    model.summary.passed + model.summary.failed + model.summary.skipped + model.summary.blocked;
  const lines: string[] = [];

  lines.push(`# ${mdEscape(model.projectName)} · ${zhCN.reportTitleSuffix}`);
  lines.push('');
  lines.push(`> ${zhCN.productName} · ${zhCN.labelRunId}：${code(model.runId)}`);
  lines.push('');

  // 项目与环境
  lines.push(`## ${zhCN.sectionProjectAndEnvironment}`);
  lines.push('');
  lines.push(`- **${zhCN.labelEnvironment}**：${mdEscape(model.environment ?? '—')}`);
  lines.push(`- **${zhCN.labelStartedAt}**：${mdEscape(model.startedAt)}`);
  lines.push(`- **${zhCN.labelFinishedAt}**：${mdEscape(model.finishedAt)}`);
  lines.push('');

  // 计划与运行
  lines.push(`## ${zhCN.sectionPlanAndRun}`);
  lines.push('');
  lines.push(`- **${zhCN.labelRunId}**：${code(model.runId)}`);
  lines.push(
    `- **${zhCN.labelPlanId}**：${code(model.planId)}${model.planDigest ? `（${mdEscape(model.planDigest)}）` : ''}`,
  );
  lines.push('');

  // 结果概览（通过、失败、阻塞和跳过）
  lines.push(`## ${zhCN.sectionOutcomeSummary}`);
  lines.push('');
  lines.push(`- ${zhCN.metricPassed}：${model.summary.passed}`);
  lines.push(`- ${zhCN.metricFailed}：${model.summary.failed}`);
  lines.push(`- ${zhCN.metricSkipped}：${model.summary.skipped}`);
  lines.push(`- ${zhCN.metricBlocked}：${model.summary.blocked}`);
  lines.push(`- ${zhCN.labelTotalTests}：${total}`);
  lines.push('');

  // 执行范围（已发现路由/页面/接口/场景/角色/浏览器）
  lines.push(`## ${zhCN.sectionExecutionScope}`);
  lines.push('');
  lines.push(
    `| ${zhCN.colDimension} | ${zhCN.colDiscovered} | ${zhCN.colCovered} | ${zhCN.colBlocked} | ${zhCN.colRate} |`,
  );
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const dim of model.coverage) {
    lines.push(
      `| ${mdEscape(dim.name)} | ${dim.discovered} | ${dim.covered} | ${dim.blocked ?? 0} | ${coverageRate(dim)} |`,
    );
  }
  lines.push('');

  // 角色与浏览器
  const roles = Array.from(
    new Set(model.results.map((r) => r.role).filter((role): role is string => Boolean(role))),
  );
  const browsersDim = model.coverage.find((c) => c.name === 'Browsers');
  lines.push(`## ${zhCN.sectionRolesAndBrowsers}`);
  lines.push('');
  if (roles.length > 0) {
    lines.push(`- ${roles.map(code).join('、')}`);
  }
  if (browsersDim) {
    lines.push(
      `- **${zhCN.labelBrowsers}**：${zhCN.statusPassed} ${browsersDim.covered} / ${zhCN.colDiscovered} ${browsersDim.discovered}`,
    );
  }
  lines.push('');

  // 模块统计
  const byModule = new Map<string, ReportTestResult[]>();
  for (const r of model.results) {
    const key = r.module ?? zhCN.uncategorizedModule;
    const bucket = byModule.get(key) ?? [];
    bucket.push(r);
    byModule.set(key, bucket);
  }
  lines.push(`## ${zhCN.sectionModuleStats}`);
  lines.push('');
  lines.push(
    `| ${zhCN.colModule} | ${zhCN.colPassed} | ${zhCN.metricFailed} | ${zhCN.metricBlocked} | ${zhCN.colSkipped} |`,
  );
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const [module, results] of byModule) {
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const blocked = results.filter((r) => r.status === 'blocked').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    lines.push(`| ${mdEscape(module)} | ${passed} | ${failed} | ${blocked} | ${skipped} |`);
  }
  lines.push('');

  // 用例结果（关键表格）
  lines.push(`## ${zhCN.sectionTestResults}`);
  lines.push('');
  lines.push(
    `| ${zhCN.colStatus} | ${zhCN.colTest} | ${zhCN.colContext} | ${zhCN.colDuration} | ${zhCN.colEvidence} |`,
  );
  lines.push('| --- | --- | --- | ---: | --- |');
  for (const r of model.results) {
    const evidence = [r.screenshot, r.trace].filter(Boolean).map((e) => code(e)).join(' ');
    lines.push(
      `| ${statusLabel(r.status)} | ${code(r.name)} | ${mdEscape(contextOf(r))} | ${mdEscape(r.durationMs)} | ${evidence} |`,
    );
  }
  lines.push('');

  // 失败步骤
  const failed = model.results.filter((r) => r.status === 'failed' || r.status === 'blocked');
  if (failed.length > 0) {
    lines.push(`## ${zhCN.sectionFailedSteps}`);
    lines.push('');
    for (const r of failed) {
      lines.push(`### ${code(r.name)}（${statusLabel(r.status)}）`);
      lines.push('');
      if (r.error) lines.push(`- **${mdEscape(r.error)}**`);
      if (r.observations?.length) {
        for (const o of r.observations) lines.push(`- ${mdEscape(o)}`);
      }
      lines.push('');
    }
  }

  // 证据链接
  const evidences = model.results.filter((r) => r.screenshot || r.trace);
  if (evidences.length > 0) {
    lines.push(`## ${zhCN.sectionEvidence}`);
    lines.push('');
    for (const r of evidences) {
      const links: string[] = [];
      if (r.screenshot) links.push(`[截图](${mdEscape(r.screenshot)})`);
      if (r.trace) links.push(`[追踪](${mdEscape(r.trace)})`);
      lines.push(`- ${code(r.name)}：${links.join('、')}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export async function writeMarkdownReport(model: HtmlReportModel, outputPath: string): Promise<string> {
  await writeFile(outputPath, renderMarkdownReport(model), 'utf8');
  return outputPath;
}
