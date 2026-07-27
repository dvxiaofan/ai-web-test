import { describe, it, expect } from 'vitest';
import { renderMarkdownReport } from '../../src/reporting/markdown.js';
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
      { name: 'Pages', discovered: 5, covered: 4, blocked: 1 },
      { name: 'Apis', discovered: 3, covered: 3, blocked: 0 },
      { name: 'Scenarios', discovered: 2, covered: 1, blocked: 0 },
      { name: 'Roles', discovered: 2, covered: 2, blocked: 0 },
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
        screenshot: 'f.png',
        trace: 'ft.zip',
        error: '超时',
        observations: ['元素未找到'],
      },
      {
        id: 'r3',
        name: '支付阻塞',
        module: 'cart',
        route: '/pay',
        role: 'user',
        status: 'blocked',
        durationMs: 0,
        error: '第三方不可用',
        observations: [],
      },
    ],
    warnings: ['策略收紧'],
    uncovered: ['/admin 未覆盖'],
  };
}

describe('renderMarkdownReport', () => {
  const md = renderMarkdownReport(buildModel());

  it('includes the fixed Chinese sections', () => {
    for (const section of [
      '项目与环境',
      '计划与运行',
      '结果概览',
      '执行范围',
      '角色与浏览器',
      '模块统计',
      '测试用例结果',
      '失败步骤',
      '证据链接',
    ]) {
      expect(md).toContain(`## ${section}`);
    }
  });

  it('carries run/plan identity and timing', () => {
    expect(md).toContain('run_xyz');
    expect(md).toContain('plan_abc');
    expect(md).toContain('digest123');
    expect(md).toContain('staging');
  });

  it('summarizes outcomes (passed/failed/skipped/blocked)', () => {
    expect(md).toContain('通过：2');
    expect(md).toContain('失败：1');
    expect(md).toContain('跳过：0');
    expect(md).toContain('阻塞：1');
    expect(md).toContain('用例总数：4');
  });

  it('renders module statistics and failed steps', () => {
    expect(md).toContain('auth');
    expect(md).toContain('cart');
    expect(md).toContain('下单失败');
    expect(md).toContain('超时');
    expect(md).toContain('元素未找到');
  });

  it('renders evidence links', () => {
    expect(md).toContain('s.png');
    expect(md).toContain('t.zip');
  });

  it('escapes pipeline characters inside table cells', () => {
    const row = md.split('\n').find((l) => l.includes('|') && l.includes('登录成功'));
    expect(row).toBeDefined();
    expect(row).not.toContain('\\|');
  });

  it('matches snapshot', () => {
    expect(md).toMatchSnapshot();
  });
});
