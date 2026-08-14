import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../src/core/config.js';
import type { Inventory, ProjectOverview, RunResult, TestScenario } from '../../src/core/types.js';
import { writeProjectReport } from '../../src/reporting/project-report.js';

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `awt-${prefix}-`));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function buildConfig(artifactsDir: string, metadata?: unknown): ProjectConfig {
  return {
    schemaVersion: 1,
    configDir: artifactsDir,
    project: { id: 'p1', name: 'itbar', description: '' },
    target: { rootDir: '/tmp/app', baseUrl: 'http://localhost:4178', discovery: 'runtime-first', seedPaths: [] },
    artifacts: { directory: artifactsDir },
    source: { include: ['src'], exclude: [], maxFiles: 1, maxFileSizeBytes: 1 },
    runtime: { enabled: true, headless: true, profiles: [] },
    roles: [],
    auth: { roles: [] },
    policy: {
      maxRisk: 'read',
      allowedHosts: ['localhost'],
      allowExternalOrigins: false,
      allowSecretPersistence: true,
      confirmationRequired: true,
      destructiveActionAllowlist: [],
    },
    ai: { providers: [] },
    presets: {},
    report: { projectDirectory: path.join(artifactsDir, 'report') },
    ...(metadata ? { metadata } : {}),
  } as unknown as ProjectConfig;
}

function buildInventory(): Inventory {
  return {
    schemaVersion: 1,
    id: 'inv-1',
    project: { id: 'p1', name: 'itbar', rootDir: '/tmp/app' },
    nodes: [
      { id: 'm-todo', kind: 'module', name: '我的待办', description: '待办工单处理', tags: [], confidence: 1, evidence: [], sourcePaths: [], routeIds: ['r-todo'], apiIds: ['a-todo'] },
      { id: 'r-todo', kind: 'route', name: 'Todo', path: '/my-todos', tags: [], confidence: 1, evidence: [], requiresAuth: true, roleIds: [] },
      { id: 'a-todo', kind: 'api', name: 'todo list', method: 'GET', urlPattern: '/api/todos', tags: [], confidence: 1, evidence: [], observed: true },
    ],
    edges: [],
    findings: [
      {
        id: 'f-static',
        title: '待办分页越界',
        category: 'defect',
        classification: 'confirmed-defect',
        severity: 'critical',
        status: 'open',
        summary: '翻到末页后报错',
        details: '第 11 页返回 500',
        evidence: [],
        relatedIds: ['m-todo'],
      },
    ],
    coverage: {
      routes: { discovered: 1, visited: 1, rendered: 1 },
      pages: { discovered: 1, rendered: 1, withScenario: 1 },
      apis: { discovered: 1, observed: 1, asserted: 0 },
      roles: { configured: 1, exercised: 1 },
      scenarios: { discovered: 1, proposed: 1, approved: 1 },
      unresolved: 1,
    },
  } as unknown as Inventory;
}

function buildScenarios(): TestScenario[] {
  return [
    { id: 's-todo', name: '待办冒烟', description: '', moduleIds: ['m-todo'], routeIds: ['r-todo'], operationIds: [], roleIds: [], steps: [], risk: 'read' },
  ] as unknown as TestScenario[];
}

function buildRunResult(): RunResult {
  return {
    id: 'run_1',
    planId: 'plan_1',
    status: 'completed',
    startedAt: '',
    endedAt: '',
    scenarios: [
      { scenarioId: 's-todo', role: 'admin', status: 'passed', steps: [], artifacts: [], findingIds: [] },
    ],
    findings: [
      {
        id: 'f-run',
        title: '导出按钮无响应',
        category: 'defect',
        classification: 'confirmed-defect',
        severity: 'medium',
        status: 'open',
        summary: '点击导出无下载',
        details: '',
        evidence: [],
        relatedIds: ['s-todo'],
      },
    ],
    coverage: {},
  } as unknown as RunResult;
}

function buildOverview(): ProjectOverview {
  return {
    schemaVersion: 1,
    updatedAt: '2026-07-30T00:00:00.000Z',
    e2eFlows: [
      { name: '提单到关单', steps: ['创建工单', '受理', '关闭'], status: 'failed', scenarioIds: [], notes: '关单卡住' },
    ],
    nextSteps: [{ priority: 'high', text: '补充权限矩阵用例' }],
    acceptance: [
      { item: '全模块冒烟通过', done: true },
      { item: '缺陷全部复核', done: false, notes: '待开发确认' },
    ],
    conclusions: [{ at: '2026-07-30T00:00:00.000Z', text: '首轮回归完成' }],
  };
}

async function renderIndex(input: {
  metadata?: unknown;
  overview?: ProjectOverview;
  runResult?: RunResult;
}): Promise<string> {
  const artifactsDir = tmp('report');
  const config = buildConfig(artifactsDir, input.metadata);
  const result = await writeProjectReport({
    config,
    inventory: buildInventory(),
    scenarios: buildScenarios(),
    ...(input.runResult ? { runResult: input.runResult } : {}),
    ...(input.overview ? { overview: input.overview } : {}),
  });
  return readFileSync(result.indexHtmlPath, 'utf8');
}

describe('project report business overview', () => {
  it('renders the module detail table with routes, apis and execution status', async () => {
    const html = await renderIndex({ runResult: buildRunResult() });
    expect(html).toContain('<table class="grid">');
    expect(html).toContain('我的待办');
    expect(html).toContain('/my-todos');
    expect(html).toContain('待办工单处理');
    expect(html).toContain('执行状态');
  });

  it('aggregates findings from inventory and run into one defect pool, worst severity first', async () => {
    const html = await renderIndex({ runResult: buildRunResult() });
    expect(html).toContain('缺陷池（2）');
    expect(html).toContain('待办分页越界');
    expect(html).toContain('导出按钮无响应');
    expect(html.indexOf('待办分页越界')).toBeLessThan(html.indexOf('导出按钮无响应'));
    expect(html).toContain('严重');
    // Findings are related back to module and scenario names.
    expect(html).toContain('我的待办');
    expect(html).toContain('待办冒烟');
  });

  it('renders project facts from config metadata', async () => {
    const html = await renderIndex({
      metadata: {
        overview: {
          intro: 'IT 服务工单平台',
          techStack: 'Vue3 + Spring Boot',
          conventions: ['只读账号不得提交工单'],
          businessSystems: ['ITR-GD', 'ITR-SZ'],
          accounts: [{ role: 'admin', note: '管理员账号由环境变量注入' }],
        },
      },
    });
    expect(html).toContain('系统简介与测试约定');
    expect(html).toContain('IT 服务工单平台');
    expect(html).toContain('Vue3 + Spring Boot');
    expect(html).toContain('ITR-GD');
    expect(html).toContain('只读账号不得提交工单');
  });

  it('renders e2e flows, next steps, acceptance and conclusions from overview.json', async () => {
    const html = await renderIndex({ overview: buildOverview(), runResult: buildRunResult() });
    expect(html).toContain('全流程（E2E）链路（1）');
    expect(html).toContain('创建工单 → 受理 → 关闭');
    expect(html).toContain('下一步建议（1）');
    expect(html).toContain('补充权限矩阵用例');
    expect(html).toContain('验收清单（1/2）');
    expect(html).toContain('阶段结论');
    expect(html).toContain('首轮回归完成');
  });

  it('degrades gracefully when overview and metadata are absent', async () => {
    const html = await renderIndex({});
    expect(html).not.toContain('系统简介与测试约定');
    expect(html).not.toContain('全流程（E2E）链路');
    expect(html).not.toContain('下一步建议');
    expect(html).not.toContain('阶段结论');
    // The static sections still render.
    expect(html).toContain('全部业务模块（1）');
    expect(html).toContain('缺陷池（1）');
  });

  it('marks a runtime-first project in the header', async () => {
    const html = await renderIndex({});
    expect(html).toContain('零源码模式（runtime-first）');
  });
});
