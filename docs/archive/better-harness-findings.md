# Better Harness 体检报告 — ai-web-test

> 由 Better Harness（`@qoder-ai/better-harness` v0.5.0）独立脚本模式（standalone, `--no-sessions`）对
> 本项目做静态证据扫描所得。生成时间：2026-08-10。
> 说明：当前运行环境为 CodeBuddy，无 Better Harness 原生 skill，故走"克隆仓库 + 跑独立脚本"路径，
> 只采集**仓库证据**，不含会话级证据。精修的 `report.html/md` 需在其支持宿主内合成，本报告为证据层汇总。

## 总体判断

代码本身规整（117 个源文件 + 96 个测试文件），但**面向 AI 编程 Agent 的"harness"（外围基础设施）很薄**。
核心缺口集中在：缺 `AGENTS.md`、验证证据未接入闭环、缺依赖自动更新、无学习沉淀机制。

## 五维度结果

| 维度 | 评级 | 关键证据 |
|------|------|---------|
| Task Understanding（目标理解） | ⚠️ 薄弱 | `agentInstructions.count = 0`，无 canonical `AGENTS.md`，仅有的 agent 规范散落在 `.github/workflows/ai-web-test.yml` |
| Controlled Execution（受控执行） | ⚠️ 一般 | project assets = 1（仅一个 qoder workflow），无项目级 Skills / MCP / 插件，memories = 0 |
| Change Validation（变更验证） | ⚠️ 证据缺失 | diff 干净、无需 review；但 `testsPassed / ciStatus / runtimeBehavior` 三项均 `UNVERIFIED` |
| Reliable Delivery（可靠交付） | ⚠️ 中风险 | 依赖更新自动化 = 0（无 Dependabot/Renovate），audit 信号 = 0；好在有 CI workflow 存在 |
| Learning Capture（学习沉淀） | ❌ 缺失 | 无 memory / learnings 机制，下次任务无法从此任务受益 |

## 各命令证据要点

### 1. `report --no-sessions`（快速体检）
- 项目名 `ai-web-test`，语言 TypeScript；sourceFiles 117 / testFiles 96。
- `agentInstructions.count = 0` → `status: missing`。
- sessions: `available: false`，走 `static-fallback` 路由。

### 2. `core-change-watch evidence-pack`（项目与历史证据包）
- 主要语言 TypeScript（源 116 / 测试 92）+ JavaScript（1 / 4）。
- `agentInstructions.status = missing`，建议补 1 个根级 + 1 个附加 `AGENTS.md`；建议范围示例：`src/business`、`src/discovery`、`src/auth`、`src/browser`、`src/execution`（各 7–10 源文件）。
- 核心候选文件（high confidence 15 / medium 2）：`runtime/target-process.ts`、`core/planner.ts`、`core/policy.ts`、`browser/*`、`cli/*` 等。
- `historyConfidence = medium`，原因：`history span is only 18 days`。
- **明确未验证的声明**（证据边界，不伪装）：`tests passed`、`CI status`、`runtime behavior` —— 工具不跑测试、不查外部 CI、不执行目标应用。

### 3. `dependency-governance`（依赖治理）
- 生态系统：node；manifest 3 个（`package.json`、fixtures 与 astro-sample）、lockfile 1 个。
- finding：`dependency-update-automation-missing`（Medium）—— 未找到依赖自动更新配置。
- 无 audit 信号、无 alert 证据；风险等级 `medium`。
- 依赖文件均非 stale（最近修改 0–18 天前）。

### 4. `agent-lint --profile agents-md-review`（AGENTS.md 合规审查）
- 1 条 finding：`no-canonical-agents-md`（warning）。
- 证据：未找到根级 `AGENTS.md`，策略目前只存在于 vendor 专属表面。
- 修复建议（passCheck）：存在根级 `AGENTS.md`，且工具专属文件不再是唯一的项目级规则来源。
- 关联 rubric：`AGENTS.md And CLAUDE.md Split`。

### 5. `coding-agent-practices inventory`（Agent 资产清单）
- project assets = 1（` .github/workflows/ai-web-test.yml`）；user assets = 0、plugin assets = 0、memories = 0。
- `customizeDiagnostics.installedPluginState = not-authorized`。

## 优先级改进清单

1. **补 `AGENTS.md`（高）** — 写明项目目标、"完成"定义、技术栈与约定；工具专属规则留在各自文件。直接修复 Task Understanding 与 agent-lint 告警。
2. **闭环验证证据（高）** — 让 Agent 改动后能拿到可验证信号：确保 `npm test` / `npm run typecheck` / CI 状态能被读取，不要停留在"UNVERIFIED"。
3. **依赖自动更新（中）** — 启用 Dependabot 或 Renovate，并定期 `npm audit`，消除 `dependency-update-automation-missing`。
4. **学习沉淀（中）** — 引入 memory / lessons-learned 机制（如 `docs/` 下的复盘记录或 Agent 记忆），支撑 Learning Capture。

## 证据边界（诚实声明）

- 未读取任何本地会话/聊天记录（standalone 模式）。
- `core-change-watch` 不运行目标测试、不打开外部 CI、不执行应用；凡涉及"测试是否通过 / CI 状态 / 运行时行为"的断言均为 **UNVERIFIED**，未计入评分。
- 工具未修改本项目任何文件；本次运行的临时产物（`.qoder/`）已清理。
