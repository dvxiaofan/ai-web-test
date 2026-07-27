/**
 * Phase 1.3 — fixed Chinese report copy.
 *
 * All human-facing report strings live here so the Markdown and HTML reporters
 * stay consistent and localizable. These are fixed labels, not user data, and
 * must never contain secrets.
 */
export const zhCN = {
  productName: 'AI 网页测试',
  reportTitleSuffix: 'AI 网页测试报告',

  statusPassed: '通过',
  statusFailed: '失败',
  statusSkipped: '跳过',
  statusBlocked: '阻塞',
  statusWarning: '告警',

  sectionProjectAndEnvironment: '项目与环境',
  sectionPlanAndRun: '计划与运行',
  sectionOutcomeSummary: '结果概览',
  sectionExecutionScope: '执行范围',
  sectionRolesAndBrowsers: '角色与浏览器',
  sectionCoverage: '覆盖率',
  sectionTestResults: '测试用例结果',
  sectionModuleStats: '模块统计',
  sectionFailedSteps: '失败步骤',
  sectionEvidence: '证据链接',
  sectionWarnings: '告警',
  sectionUncovered: '未覆盖或阻塞的资产',
  sectionPayload: '机器可读报告数据',

  metricPassed: '通过',
  metricFailed: '失败',
  metricSkipped: '跳过',
  metricBlocked: '阻塞',

  labelRunId: '运行 ID',
  labelPlanId: '计划 ID',
  labelStartedAt: '开始时间',
  labelFinishedAt: '结束时间',
  labelEnvironment: '环境',
  labelTotalTests: '用例总数',
  labelBrowsers: '浏览器',

  colDimension: '维度',
  colDiscovered: '已发现',
  colCovered: '已覆盖',
  colBlocked: '阻塞',
  colRate: '覆盖率',
  colStatus: '状态',
  colTest: '用例',
  colContext: '上下文',
  colDuration: '耗时',
  colEvidence: '证据',
  colModule: '模块',
  colPassed: '通过',
  colSkipped: '跳过',

  unitTest: '用例',
  linkScreenshot: '截图',
  linkTrace: '追踪',

  uncategorizedModule: '未分类',
} as const;

export type ChineseCopy = typeof zhCN;
