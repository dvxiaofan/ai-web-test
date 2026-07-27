import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zhCN } from './zh-CN.js';
import type { HtmlReportModel, ReportTestResult } from './types.js';

function zhStatus(status: string): string {
  switch (status) {
    case 'passed':
      return zhCN.statusPassed;
    case 'failed':
      return zhCN.statusFailed;
    case 'blocked':
      return zhCN.statusBlocked;
    case 'warning':
      return zhCN.statusWarning;
    default:
      return zhCN.statusSkipped;
  }
}

export async function writeHtmlReport(model: HtmlReportModel, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderHtmlReport(model), 'utf8');
}

export function renderHtmlReport(model: HtmlReportModel): string {
  const total = model.summary.passed + model.summary.failed + model.summary.skipped + model.summary.blocked;
  const status = model.summary.failed > 0 ? 'failed' : model.summary.blocked > 0 ? 'warning' : 'passed';
  const json = escapeHtml(JSON.stringify(model, null, 2));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(model.projectName)} · ${escapeHtml(zhCN.reportTitleSuffix)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; background: #f5f7fb; }
    body { margin: 0; }
    main { max-width: 1180px; margin: 0 auto; padding: 36px 24px 80px; }
    h1, h2 { letter-spacing: -.02em; }
    .muted { color: #667085; }
    .hero, .card { background: white; border: 1px solid #e4e7ec; border-radius: 14px; box-shadow: 0 2px 8px #1018280a; }
    .hero { padding: 28px; margin-bottom: 20px; border-left: 6px solid ${statusColor(status)}; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
    .card { padding: 18px; margin-bottom: 18px; }
    .metric strong { display: block; font-size: 30px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #eaecf0; padding: 11px 8px; vertical-align: top; }
    th { color: #475467; font-size: 13px; text-transform: uppercase; }
    .pill { display: inline-block; border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; }
    .passed { color: #067647; background: #ecfdf3; }
    .failed { color: #b42318; background: #fef3f2; }
    .skipped, .blocked, .warning { color: #b54708; background: #fffaeb; }
    details pre { overflow: auto; background: #101828; color: #d0d5dd; padding: 16px; border-radius: 10px; }
    ul { padding-left: 22px; }
    a { color: #175cd3; }
  </style>
</head>
<body><main>
  <section class="hero">
    <p class="muted">${escapeHtml(zhCN.productName)} · ${escapeHtml(model.runId)}</p>
    <h1>${escapeHtml(model.projectName)}</h1>
    <p><span class="pill ${status}">${zhStatus(status)}</span> ${total} ${zhCN.unitTest} · ${zhCN.labelPlanId} ${escapeHtml(model.planId)}</p>
    <p class="muted">${escapeHtml(model.startedAt)} → ${escapeHtml(model.finishedAt)}${model.environment ? ` · ${escapeHtml(model.environment)}` : ''}</p>
  </section>

  <section class="grid">
    ${metric(zhCN.metricPassed, model.summary.passed, 'passed')}
    ${metric(zhCN.metricFailed, model.summary.failed, 'failed')}
    ${metric(zhCN.metricSkipped, model.summary.skipped, 'skipped')}
    ${metric(zhCN.metricBlocked, model.summary.blocked, 'blocked')}
  </section>

  <section class="card"><h2>${escapeHtml(zhCN.sectionCoverage)}</h2>
    <table><thead><tr><th>${zhCN.colDimension}</th><th>${zhCN.colCovered}</th><th>${zhCN.colDiscovered}</th><th>${zhCN.colBlocked}</th><th>${zhCN.colRate}</th></tr></thead>
    <tbody>${model.coverage.map(coverageRow).join('')}</tbody></table>
  </section>

  <section class="card"><h2>${escapeHtml(zhCN.sectionTestResults)}</h2>
    <table><thead><tr><th>${zhCN.colStatus}</th><th>${zhCN.colTest}</th><th>${zhCN.colContext}</th><th>${zhCN.colDuration}</th><th>${zhCN.colEvidence}</th></tr></thead>
    <tbody>${model.results.map(resultRow).join('')}</tbody></table>
  </section>

  ${listSection(zhCN.sectionWarnings, model.warnings)}
  ${listSection(zhCN.sectionUncovered, model.uncovered)}

  <section class="card"><details><summary>${escapeHtml(zhCN.sectionPayload)}</summary><pre>${json}</pre></details></section>
</main></body></html>`;
}

function metric(label: string, value: number, className: string): string {
  return `<article class="card metric"><span class="muted">${label}</span><strong class="${className}">${value}</strong></article>`;
}

function coverageRow(item: HtmlReportModel['coverage'][number]): string {
  const rate = item.discovered === 0 ? '—' : `${Math.round((item.covered / item.discovered) * 100)}%`;
  return `<tr><td>${escapeHtml(item.name)}</td><td>${item.covered}</td><td>${item.discovered}</td><td>${item.blocked ?? 0}</td><td>${rate}</td></tr>`;
}

function resultRow(result: ReportTestResult): string {
  const context = [result.module, result.route, result.role].filter(Boolean).join(' · ');
  const links = [
    result.screenshot ? `<a href="${escapeAttribute(result.screenshot)}">${zhCN.linkScreenshot}</a>` : '',
    result.trace ? `<a href="${escapeAttribute(result.trace)}">${zhCN.linkTrace}</a>` : '',
  ].filter(Boolean).join(' · ');
  const details = [result.error, ...(result.observations ?? [])].filter(Boolean).map((text) => escapeHtml(text ?? '')).join('<br>');
  return `<tr><td><span class="pill ${result.status}">${zhStatus(result.status)}</span></td><td><strong>${escapeHtml(result.name)}</strong>${details ? `<br><small>${details}</small>` : ''}</td><td>${escapeHtml(context)}</td><td>${result.durationMs === undefined ? '—' : `${result.durationMs} ms`}</td><td>${links || '—'}</td></tr>`;
}

function listSection(title: string, items: string[]): string {
  if (items.length === 0) return '';
  return `<section class="card"><h2>${escapeHtml(title)}</h2><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
}

function statusColor(status: string): string {
  return status === 'passed' ? '#12b76a' : status === 'failed' ? '#f04438' : '#f79009';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
