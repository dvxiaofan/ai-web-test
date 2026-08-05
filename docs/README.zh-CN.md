# AI Web Test 中文使用说明

AI Web Test 是一套面向已有 Web 项目的可复用自动化测试工具。它同时分析
源码与真实浏览器页面，建立页面、路由、接口、角色和业务场景清单，然后先
生成计划、等待操作者确认，最后才执行测试。

> 当前版本是 alpha/MVP：适合受控的本地或隔离测试环境，不应直接连接生产、
> 真实支付或共享用户数据。使用前请阅读[实际可用范围与限制](READINESS.md)。

## 核心原则

```text
发现项目 → 生成业务清单 → 选择全量/模块/场景 → 审批计划 → 浏览器执行 → 报告
```

第一次接入不会直接执行全量测试。`discover` 只做源码分析和观察式浏览器
探索，不点击按钮、不提交表单。只有 `approved` 状态的计划才能被 `run`
执行。

## 已实现能力

- 框架、路由、接口、页面和源码文件发现；
- 持久化的项目清单（inventory）与覆盖率模型；
- 业务清单层（实体、业务动作、业务规则、权限、状态机），与技术清单共用
  同一套 id 坐标，不污染核心清单的节点类型与覆盖率统计；
- 全量/模块/场景的交互式计划选择；
- Playwright 浏览器探索与确定性执行；
- UI、接口、登录态复用、自定义适配器四种角色认证方式；
- 带截图、Trace、Console 和网络证据的 HTML 与 JSON 报告；
- 确定性失败分类 + 可审计、绝不自动应用的修复提案，以及历史趋势、flaky
  识别和产物保留策略；
- 可选的 AI 计划建议与失败归因；
- 机器可读的 CLI 输出，以及供 Codex 等 AI 客户端使用的 MCP 服务
  （`awt_*` 工具）。

除 Playwright 浏览器包外，静态发现不依赖任何可选运行时组件。浏览器或其
可执行文件不可用时，发现阶段返回结构化的 `unavailable` 结果，而不会假装
已经覆盖了运行时。

## 安装与运行

```bash
cd ai-web-test
npm install
npx playwright install chromium
npm run build

# 有源码的项目：
npm run aitest -- init ../目标项目目录 \
  --url http://127.0.0.1:3000 \
  --start "npm run dev"
# 没有源码、只有页面地址的项目（runtime-first 黑盒模式）：
npm run aitest -- init --url http://127.0.0.1:3000 --name 项目名

npm run aitest -- discover --project 项目名 --start
npm run aitest -- plan --project 项目名
npm run aitest -- approve --project 项目名 --plan <计划ID>
npm run aitest -- run --project 项目名 --plan <计划ID>
```

`init` 会为每个被测项目在工具目录下建立独立工作区
`test-output/<项目名>/`，包含 `config.json`（该项目的配置）、`artifacts/`
（清单、计划、运行记录）、`report/`（人类可读报告树）、`docs/`（手写分析文档）
和 `scripts/`（该项目专用的一次性脚本）。`--project <项目名>`
是 `--config test-output/<项目名>/config.json` 的简写。

这个布局是**强制**的，不是约定：`artifacts.directory` 与
`report.projectDirectory` 解析后必须落在配置文件所在目录内，越界的路径会让配置
直接加载失败。所有 `--json` 输出都带 `workspace` 字段列出这些绝对路径——手写
文件请照着写，不要自己猜位置。`aitest doctor` 会检查漏到工作区外的目标文件、
缺失的报告树，以及工作区文件里的明文口令。`test-output/` 整体被 git 忽略，
工具还会在每个产物目录内自动写入自忽略的 `.gitignore`，确保被测项目的数据
（截图、内网地址、登录态）不会进入版本库。

如果执行 `plan` 时没有传入范围，工具会询问操作者选择：

- 核心冒烟测试；
- 一个或多个业务模块；
- 指定业务场景；
- 根据 Git 代码变更选择受影响范围；
- 全量回归。

## 测试范围（scope）

同一份清单可以按不同粒度测试：

```bash
npm run aitest -- plan --scope full                          # 全量回归
npm run aitest -- plan --scope module --module order         # 按业务模块
npm run aitest -- plan --scope route --route <路由ID>         # 按单个路由
npm run aitest -- plan --scope scenario --scenario <场景ID>   # 按指定场景
npm run aitest -- plan --scope tag --tag smoke               # 按标签（冒烟）
npm run aitest -- plan --scope affected                      # 按 Git 变更影响面
npm run aitest -- plan --scope failed --failed-run <运行ID>   # 只重跑上次失败
npm run aitest -- plan --preset ci-smoke --non-interactive   # CI 用的可信预设

npm run aitest -- run --plan <已审批计划ID>
# 确实是有意改动 UI 时，显式接受当前截图作为新的视觉基线
npm run aitest -- run --plan <已审批计划ID> --update-baselines
```

`--module` 可以重复传入或用逗号分隔。模块选择会自动加入登录、数据准备等
已知前置依赖，并在计划中列出自动加入的场景和原因。

AI 助手和 CI 请统一加 `--json`。每个计划和运行都带摘要（digest），因此任何
一份报告都能追溯回它对应的清单、安全策略、范围、角色和浏览器配置。

## 无源码项目（黑盒模式）

静态发现需要源码目录。只有页面地址和账号时，把项目切换成 `runtime-first`：
清单从 `baseUrl` 起步，由浏览器探索补全，而不是靠 AST 分析。
`aitest init --url <地址> --name <项目名>`（不传目标目录）生成的正是这种配置。

```jsonc
{
  "target": {
    "baseUrl": "https://app.example.com",   // 该模式下必填
    "discovery": "runtime-first",
    "seedPaths": ["/login", "/orders"]       // 可选的额外入口
  }
}
```

```bash
npm run aitest -- discover --project 项目名
# 或者不改配置，临时以运行时模式跑一次：
npm run aitest -- discover --project 项目名 --runtime-only
```

请先配好 `auth.roles`：在登录墙后面，未登录的爬取只能走到登录页。

探索到不了从未被导航过的深层链接，也发现不了从未被触发的接口。缺的部分
用结构化补录来补，不要手改 `inventory.json`：

```jsonc
// supplement.json
{
  "source": "ai",
  "modules": [
    { "name": "工单广场", "description": "公共工单池",
      "routes": ["/square"], "apis": [{ "method": "GET", "path": "/api/square" }] }
  ],
  "routes": [{ "path": "/profile", "module": "个人中心", "requiresAuth": true }]
}
```

```bash
npm run aitest -- inventory merge --project 项目名 --file supplement.json
```

补录进来的节点会打上 `externally-supplied` 标记并携带 `ai` / `operator`
证据，始终和真正发现到的事实区分得开。非法条目会被跳过并以警告形式报出，
不会让整批补录失败。

想知道黑盒这一轮漏了多少，就和同一个项目的源码基线做对比：

```bash
npm run aitest -- inventory diff --base 源码版/inventory.json --compare 黑盒版/inventory.json
```

对比按业务身份匹配节点（模块名、路由路径、方法+路径），而不是节点 id，
输出分类型的召回率以及具体缺失和多出的条目。

## 运营期命令

项目完成一次发现和执行之后可用：

```bash
npm run aitest -- status --project 项目名          # 清单与覆盖率概览
npm run aitest -- auth --project 项目名 --role admin   # 登录并保存登录态

# 把一次失败运行归类为确定性的失败类型（不会自动改动任何测试）
npm run aitest -- healing --project 项目名 --run <运行ID>
# 审查一个待定的修复，产出可审计的修复提案
npm run aitest -- healing --project 项目名 --run <运行ID> --before 旧.ts --after 新.ts

npm run aitest -- trends --project 项目名          # 通过率、覆盖率、flaky 用例
npm run aitest -- retention --project 项目名 --max-runs 20 --dry-run
```

自愈永远不会自己改写测试：它只做失败分类，并输出可审查、可回滚的提案。
削弱断言或把用例 skip 掉来「刷绿」会被直接拒绝。

`aitest mcp` 以 stdio 启动 MCP 服务，对外暴露与 CLI 相同的能力
（`awt_discover`、`awt_plan`、`awt_approve`、`awt_run`、`awt_report`、
`awt_project_report`、`awt_status`、`awt_business`、`awt_inventory_query`、
`awt_scenarios_generate`、`awt_healing_*`）。

## UI级测试内容

- 真实 Chromium/Firefox/WebKit 页面操作；
- 页面加载、跳转、表单和业务断言；
- 请求响应、失败接口、Console 和页面异常；
- 横向溢出、文字裁切、控件过小和控件离开视口；
- 图片替代文本、表单标签、控件可访问名称和重复ID等基础无障碍检查；
- 经策略显式允许后保存截图、Trace 和失败证据；
- 显式更新的视觉截图基线；
- 可选 AI 场景建议和失败归因。

## 安全控制

- 默认只允许 `read` 风险；
- 创建/修改数据属于 `mutate`；
- 删除、支付、退款、发送、发布属于 `destructive`；
- 破坏性动作必须同时满足风险等级、动作白名单和测试数据策略；
- 域名白名单外的请求默认阻断；
- WebSocket 当前默认 fail-closed，后续需专门的消息级风险策略；
- 账号和密钥只能引用环境变量；
- AI不能提高已经审批的风险等级。

## 项目报告树（交付给人看）

`aitest run` 每次跑完都会自动生成这棵报告树（用 `--no-project-report` 可跳过）；
需要单独重建时用 `aitest report --by-module`（或 MCP 工具
`awt_project_report`）。它固定落在工作区内的 `test-output/<项目名>/report/`，
`report.projectDirectory` 可以改名，但改不出工作区：

```text
test-output/<项目名>/report/
  index.html              # 第一份文档：全局业务模块分析
  <模块名>/                # 每个被测模块一个子目录
    module.html           # 测试业务、每个步骤（含截图）、结论、发现的问题
    screenshot-001.png …  # 步骤截图，就放在报告旁边
```

- `index.html` 是**必须存在的第一份文档**：列出所有已发现的业务模块及其
  路由、页面、接口、场景，并链接到各模块报告。它由 `inventory.json` 生成，
  不需要先跑测试。渲染顺序固定为：项目概况 → 覆盖率统计 → 模块表 →
  缺陷池（汇总 `inventory.json` 与最近一次运行的 findings，按严重程度倒序）
  → 端到端流程 → 后续计划 → 验收清单 → 阶段结论。没有数据的小节直接省略，
  而不是留一个空壳。
- 每个**被测**模块会得到自己的子目录和 `module.html`，描述测试业务、每个
  步骤（`run` 时带了 `--step-screenshots` 就内嵌截图）、最终结论和发现的
  问题。没有执行过场景的模块不会出现在报告树里。
- 截图必须放在模块子目录内，这样 HTML 被直接双击打开也能正常显示。
- 逐步截图需要 `run --step-screenshots`，该开关受 `policy.allowSecretPersistence`
  管控。

### 补充 index.html 的内容

两个可选输入会让全局分析更完整。

**静态项目事实** —— 配置里的 `metadata.overview`，只在被测项目本身变化时才改：

```jsonc
{
  "metadata": {
    "overview": {
      "intro": "IT 服务工单平台",
      "techStack": "Vue 3 + Spring Boot",
      "conventions": ["只读账号不得提交工单"],
      "businessSystems": ["ITR-GD", "ITR-SZ"],
      "accounts": [{ "role": "admin", "note": "从环境变量注入" }]
    }
  }
}
```

**测试叙述** —— 产物目录下的 `overview.json`，测试过程中写入，`report` /
`awt_project_report` 会自动读取：

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-30T00:00:00.000Z",
  "e2eFlows": [
    { "name": "建单 → 派单 → 关单", "steps": ["建单", "派单", "关单"],
      "status": "passed", "scenarioIds": ["sc_1"] }
  ],
  "nextSteps": [{ "priority": "high", "text": "补齐权限矩阵覆盖" }],
  "acceptance": [{ "item": "每个模块冒烟通过", "done": false }],
  "conclusions": [{ "at": "2026-07-30T00:00:00.000Z", "text": "首轮回归完成" }]
}
```

## AI助手使用

Codex 等 AI 助手应使用 `--json`，读取以下产物：

```text
test-output/<项目名>/
├── config.json
├── artifacts/
│   ├── inventory.json
│   ├── overview.json          # 测试叙述（可选，喂给 index.html）
│   ├── scenarios.json
│   ├── plans/                 # proposed-<id>.json / approved-<id>.json
│   ├── runs/<run-id>/
│   │   ├── result.json
│   │   ├── report.html
│   │   ├── screenshots/
│   │   ├── traces/
│   │   └── logs/
│   ├── auth/                  # 各角色保存的登录态
│   ├── cache/
│   └── visual-baselines/
├── report/                    # 人类可读报告树（index.html + 各模块子目录）
├── docs/                      # AI 手写的分析文档，只能放这里
└── scripts/                   # 该项目专用的一次性脚本，只能放这里
```

**这个目录是硬约束**：跟被测项目有关的一切都在工作区内，工作区外不留任何东西。
每次 `--json` 输出都带 `workspace` 字段列出上述绝对路径，照着写即可，不要另找
位置。手写的分析文档进 `docs/`，一次性探索脚本进 `scripts/`，绝不写进工具仓库
或被测项目源码树。口令一律按环境变量名引用，不要内联进任何文件。交付前跑一次
`aitest doctor`：有越界文件、缺报告树或明文口令时它会以非零码退出。

即使不配置任何模型 API，AI 助手也能正常使用本工具：调用 CLI、读
`inventory.json`、读待审批计划、读 `result.json` 和 HTML 报告就够了。需要
模型参与场景建议和失败归因时，再显式打开 provider：

```json
{
  "ai": {
    "enabled": true,
    "provider": "openai-responses",
    "model": "<按需填写>",
    "apiKeyEnv": "OPENAI_API_KEY",
    "sendSource": false,
    "sendScreenshots": false
  }
}
```

源码和截图外发都是**默认关闭、需显式打开**。源码提示词有长度上限且只取
清单引用到的片段；模型返回的内容一律当作不可信输入做 schema 校验，不能
提高已审批的风险等级，也不能往域名白名单里加东西。

```bash
npm run aitest -- ai-plan --project 项目名     # 让模型给出参考性的业务场景建议
npm run aitest -- analyze --project 项目名 --run <失败运行ID>   # 失败归因
```

只有显式打开 `ai.sendScreenshots` 时，`analyze` 才会外发截图字节。

完整字段参考 [配置说明](CONFIGURATION.md)、[AI助手指南](AGENT_GUIDE.md)、
[场景编写](SCENARIOS.md) 和 [安全模型](SECURITY.md)。

## 代码结构

```text
src/core/          持久化数据结构、配置、安全策略、产物、稳定摘要(digest)
src/discovery/     源码遍历、框架识别、路由与接口分析
src/browser/       安全的运行时探索与证据采集
src/inventory/     覆盖率、查询、运行时/外部补录合并、清单对比
src/business/      业务清单：实体、业务动作、业务规则、权限、状态机
src/planning/      范围选择、依赖闭包、审批闸门
src/scenarios/     场景生成、去重、导入、提案、校验
src/execution/     Playwright 场景执行器、断言、证据、视觉基线
src/auth/          UI / 接口 / 登录态 / 自定义适配器四种角色认证
src/reporting/     HTML、Markdown 与机器可读的结果报告
src/ai/            与厂商无关的计划建议和失败归因适配器
src/healing/       失败分类与可审计的修复提案
src/history/       历史趋势、flaky 识别、产物保留
src/testdata/      带命名空间的测试数据与清理
src/runtime/       被测项目进程管理
src/agent/         项目生命周期状态机与 agent 响应协议
src/mcp/           MCP 服务，暴露与 CLI 相同的 awt_* 工具
src/cli.ts         命令分发入口
fixtures/          自带的样例被测应用
tests/             工具自身的单元与集成测试
docs/              设计、安全、配置与 AI 助手文档
schema/            配置文件的 JSON Schema（供编辑器补全）
test-output/       各被测项目的独立工作区（git 忽略，由 aitest init 创建）
```
