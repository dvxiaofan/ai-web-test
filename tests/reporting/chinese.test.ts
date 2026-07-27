import { describe, it, expect } from 'vitest';
import { zhCN } from '../../src/reporting/zh-CN.js';
import { renderMarkdownReport } from '../../src/reporting/markdown.js';
import { renderHtmlReport } from '../../src/reporting/html.js';
import type { HtmlReportModel } from '../../src/reporting/types.js';

function buildModel(): HtmlReportModel {
  return {
    projectName: '示例项目',
    planId: 'plan_abc',
    runId: 'run_xyz',
    planDigest: 'digest123',
    startedAt: '2026-07-27T10:00:00Z',
    finishedAt: '2026-07-27T10:05:00Z',
    environment: 'staging',
    summary: { passed: 2, failed: 1, skipped: 0, blocked: 1 },
    coverage: [
      { name: 'Routes', discovered: 10, covered: 8, blocked: 0 },
      { name: 'Browsers', discovered: 3, covered: 1, blocked: 0 },
    ],
    results: [
      {
        id: 'r1',
        name: '登录成功',
        module: 'auth',
        route: '/login',
        role: 'user',
        status: 'passed',
        durationMs: 120,
        screenshot: 's.png',
        trace: 't.zip',
        observations: [],
      },
      {
        id: 'r2',
        name: '下单失败',
        module: 'cart',
        route: '/checkout',
        role: 'user',
        status: 'failed',
        durationMs: 200,
        error: '超时',
        observations: ['元素未找到'],
      },
    ],
    warnings: ['策略收紧'],
    uncovered: ['/admin 未覆盖'],
  };
}

describe('zhCN fixed copy', () => {
  const requiredKeys = [
    'productName', 'reportTitleSuffix',
    'statusPassed', 'statusFailed', 'statusSkipped', 'statusBlocked', 'statusWarning',
    'sectionProjectAndEnvironment', 'sectionPlanAndRun', 'sectionOutcomeSummary',
    'sectionExecutionScope', 'sectionRolesAndBrowsers', 'sectionCoverage', 'sectionTestResults',
    'sectionModuleStats', 'sectionFailedSteps', 'sectionEvidence', 'sectionWarnings',
    'sectionUncovered', 'sectionPayload',
    'metricPassed', 'metricFailed', 'metricSkipped', 'metricBlocked',
    'labelRunId', 'labelPlanId', 'labelStartedAt', 'labelFinishedAt', 'labelEnvironment',
    'labelTotalTests', 'labelBrowsers',
    'colDimension', 'colDiscovered', 'colCovered', 'colBlocked', 'colRate',
    'colStatus', 'colTest', 'colContext', 'colDuration', 'colEvidence',
    'colModule', 'colPassed', 'colSkipped',
    'unitTest', 'linkScreenshot', 'linkTrace', 'uncategorizedModule',
  ];

  it('defines every required label as a non-empty string', () => {
    const copy = zhCN as Record<string, unknown>;
    for (const key of requiredKeys) {
      expect(typeof copy[key]).toBe('string');
      expect(copy[key]).not.toHaveLength(0);
    }
  });
});

describe('markdown report uses zhCN copy', () => {
  const md = renderMarkdownReport(buildModel());

  it('contains every section heading the markdown report emits', () => {
    const markdownSections = [
      '项目与环境',
      '计划与运行',
      '结果概览',
      '执行范围',
      '角色与浏览器',
      '模块统计',
      '测试用例结果',
      '失败步骤',
      '证据链接',
    ];
    for (const section of markdownSections) {
      expect(md).toContain(`## ${section}`);
    }
  });
});

describe('html report is localized', () => {
  const html = renderHtmlReport(buildModel());

  it('declares zh-CN language', () => {
    expect(html).toContain('lang="zh-CN"');
  });

  it('uses Chinese headings and copy', () => {
    expect(html).toContain(zhCN.sectionCoverage);
    expect(html).toContain(zhCN.sectionTestResults);
    expect(html).toContain(zhCN.sectionPayload);
    expect(html).toContain(zhCN.sectionWarnings);
    expect(html).toContain(zhCN.sectionUncovered);
    expect(html).toContain(zhCN.productName);
    expect(html).toContain('用例');
    expect(html).toContain('计划');
  });

  it('has no leftover English fixed copy', () => {
    expect(html).not.toContain('AI Web Test');
    expect(html).not.toContain('>Coverage<');
    expect(html).not.toContain('>Test results<');
    expect(html).not.toContain('Machine-readable report payload');
    expect(html).not.toContain('>Warnings<');
    expect(html).not.toContain('>Uncovered or blocked inventory<');
    expect(html).not.toContain('>screenshot<');
    expect(html).not.toContain('>trace<');
    expect(html).not.toContain('>Passed<');
    expect(html).not.toContain('>Failed<');
  });
});
