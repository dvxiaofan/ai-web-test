# AI Web Test

[English](docs/README.en.md) · 中文

AI Web Test（CLI 名 `aitest`）是一套面向**已有 Web 项目**的自动化测试工具。
它同时分析源码与真实浏览器页面，建立路由、页面、接口、角色和业务场景的清单，
然后生成测试计划、等待人工审批，最后才执行并产出带证据的报告。

工具仓库和被测项目**始终是分开的**——本仓库不会往你的项目里写任何东西。

> **当前是 alpha 版本**：适合受控的本地或隔离测试环境，不要直接连生产、真实支付
> 或共享用户数据。启用登录态或变更类场景之前，请先读
> [实际可用范围与限制](docs/READINESS.md)。

## 一条压倒一切的安全原则

> 先发现，再审批计划，最后才执行会改数据的测试。

这不是建议，是代码里强制的：

- `discover` 只导航和观察，绝不提交表单、绝不点击有风险的控件；
- `plan` 只写出 `proposed-<id>.json`，`approve` 才写出 `approved-<id>.json`，
  `run` 拒绝任何未批准的计划（返回 `PLAN_NOT_APPROVED`）；
- **审批是具名人类的行为**，没有默认身份，AI 不能替自己批准；
- 默认策略是 `maxRisk: read`、不允许外部域名、不持久化敏感产物、不改被测项目代码；
- 计划一旦审批就与清单、策略、场景定义三份摘要绑定，任何一个变了都要重新审批。

## 快速开始

```bash
npm install
npx playwright install chromium   # 只有需要浏览器发现/执行时才必需
npm run build                     # 必须！`npm run aitest` 跑的是 dist/，改完代码要重跑
```

```bash
# 1) 为被测项目建立独立工作区 test-output/<项目名>/
npm run aitest -- init ../你的项目目录 --url http://127.0.0.1:3000

#    没有源码、只有网址？用黑盒模式：
npm run aitest -- init --url http://127.0.0.1:3000 --name 项目名

# 2) 发现：源码分析 + 观察式浏览器探索（不点按钮、不提交表单）
#    只有你明确授权启动被测服务时才加 --start
npm run aitest -- discover --project 项目名

# 3) 生成计划。不带 --scope 时会交互式询问测哪些范围
npm run aitest -- plan --project 项目名

# 4) 审批。交互式回答提示即可；CI/非交互场景必须同时给出审批人
npm run aitest -- approve --project 项目名 --plan <计划ID> --yes --by 张三

# 5) 执行（跑完自动生成报告树）
npm run aitest -- run --project 项目名 --plan <计划ID>

# 6) 交付前自检：越界文件、缺报告树、明文口令
npm run aitest -- doctor --project 项目名
```

`--project <项目名>` 是 `--config test-output/<项目名>/config.json` 的简写。

> **`--yes` 必须配 `--by`**。非交互审批没人被问过，所以工具要求你显式写出审批人，
> 不会拿 `$USER` 顶替。

### 拿自带样例练手

不需要任何外部依赖，仓库自带一个可跑的靶子应用：

```bash
cd fixtures/sample-app && PORT=4178 node server.mjs   # 另开一个终端
npm run aitest -- init fixtures/sample-app --url http://localhost:4178
npm run aitest -- discover --project sample-app
npm run aitest -- plan --project sample-app --scope full --non-interactive
npm run aitest -- approve --project sample-app --plan <计划ID> --yes --by 你的名字
npm run aitest -- run --project sample-app --plan <计划ID>
open test-output/sample-app/report/index.html
```

## 工作区是硬约束

每个被测项目一个独立工作区，**关于它的一切都在里面，外面不留任何东西**：

```text
test-output/<项目名>/
  config.json      # 这个项目的配置（--project 就是找它）
  artifacts/       # inventory.json、scenarios.json、plans/、runs/<id>/、auth/、cache/
  report/          # 人类可读报告树：index.html + 每个被测模块一个子目录
  docs/            # 手写的分析文档，只能放这里
  scripts/         # 该项目专用的一次性脚本，只能放这里
```

这是强制的，不是约定：`artifacts.directory` 和 `report.projectDirectory` 解析后
必须落在 config 所在目录内，越界（包括通过**符号链接**绕）会让配置直接加载失败。
每次 `--json` 输出都带 `workspace` 字段列出这些绝对路径——照着写，别自己猜位置。

`test-output/` 整体被 git 忽略，工具还会往它创建的每个目录写入自忽略的
`.gitignore`，确保被测项目的数据（截图、内网地址、登录态）不会进版本库。

## 与 AI 助手配合使用

这是本工具的主要使用方式。两条通道，能力等价。

### 方式一：AI 直接调 CLI

任何能执行命令的 AI 助手（Claude Code、Codex、Cursor…）都可以直接用 CLI，
**不需要配置任何模型 API**。给它加上 `--json`：

```bash
npm run aitest -- discover --project 项目名 --json
```

每条 `--json` 输出都包含：

- `nextActions` —— 下一步该调什么命令、带什么参数，助手不用猜；
- `state` —— 当前处在 `initialized / discovered / plan_proposed / plan_approved / running / completed` 哪一步；
- `workspace` —— 六个绝对路径，写文件时照着放。

助手要读的产物：`artifacts/inventory.json`（项目清单）、`artifacts/plans/`（待审批
与已审批计划）、`artifacts/runs/<id>/result.json`（执行结果与断言证据）、
`report/index.html`（人看的报告）。

完整的协作契约见 [AI 助手指南](docs/AGENT_GUIDE.md)。

### 方式二：接入 MCP

`aitest mcp` 以 stdio 启动 MCP 服务，把同样的能力暴露为 `awt_*` 工具
（`awt_discover`、`awt_plan`、`awt_approve`、`awt_run`、`awt_report`、
`awt_project_report`、`awt_status`、`awt_business`、`awt_inventory_query`、
`awt_scenarios_generate`、`awt_doctor`、`awt_healing_*`）。

> **MCP 服务是按目标启动的**：它在启动时解析 `--project` / `--config`，
> 配置不存在就直接拒绝启动。所以**必须先跑一次 `aitest init`**，
> 而且一个 MCP server 实例只服务一个被测项目。要测多个项目就配多个条目。

**Claude Code** —— 在你的工作目录下建 `.mcp.json`：

```json
{
  "mcpServers": {
    "aitest-我的项目": {
      "command": "node",
      "args": [
        "/绝对路径/ai-web-test/dist/cli.js",
        "mcp",
        "--project",
        "我的项目"
      ]
    }
  }
}
```

**Codex CLI** —— 写进 `~/.codex/config.toml`：

```toml
[mcp_servers.aitest]
command = "node"
args = ["/绝对路径/ai-web-test/dist/cli.js", "mcp", "--project", "我的项目"]
```

注意三点：

1. 路径必须是**绝对路径**，且指向 `dist/cli.js`（所以要先 `npm run build`）；
2. `--project 我的项目` 对应 `test-output/我的项目/config.json`，
   要用别的位置就换成 `--config /绝对路径/config.json`；
3. MCP 通道**不会**降低审批门槛：`awt_approve` 必须同时传 `confirm: true` 和
   `by`（真人姓名），两者都没有默认值。AI 助手应当把计划摘要拿给人看、
   得到答复之后再调用，不能替自己确认。

### 可选：让模型参与场景建议与失败归因

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

源码和截图外发**默认关闭、需显式打开**。源码提示词有长度上限且只取清单引用到的
片段；模型返回一律当作不可信输入做 schema 校验，**不能提高已审批的风险等级，
也不能往域名白名单里加东西**。

```bash
npm run aitest -- ai-plan --project 项目名                    # 参考性的业务场景建议
npm run aitest -- analyze --project 项目名 --run <失败运行ID>   # 失败归因
```

## 测试范围（scope）

同一份清单可以按不同粒度测试：

```bash
npm run aitest -- plan --scope full                          # 全量回归
npm run aitest -- plan --scope module --module 订单           # 按业务模块
npm run aitest -- plan --scope route --route <路由ID>         # 按单个路由
npm run aitest -- plan --scope scenario --scenario <场景ID>   # 按指定场景
npm run aitest -- plan --scope tag --tag smoke               # 按标签（冒烟）
npm run aitest -- plan --scope affected                      # 按 Git 变更影响面
npm run aitest -- plan --scope failed --failed-run <运行ID>   # 只重跑上次失败
npm run aitest -- plan --preset ci-smoke --non-interactive   # CI 用的可信预设

# 确实是有意改动 UI 时，显式接受当前截图作为新的视觉基线
npm run aitest -- run --plan <已审批计划ID> --update-baselines
```

`--module` 可重复传入或用逗号分隔。模块选择会自动加入登录、数据准备等已知前置
依赖，并在计划里单独列出「自动加入了哪些场景、为什么」，供审批人过目。

每个计划和运行都带摘要（digest），所以任何一份报告都能追溯回它对应的清单、
安全策略、范围、角色和浏览器配置。

## 无源码项目（黑盒模式）

静态发现需要源码目录。只有网址和账号时，把项目切换成 `runtime-first`：清单从
`baseUrl` 起步，由浏览器探索补全，而不是靠 AST 分析。

```jsonc
{
  "target": {
    "baseUrl": "https://app.example.com",   // 该模式下必填
    "discovery": "runtime-first",
    "seedPaths": ["/login", "/orders"]       // 可选的额外入口
  }
}
```

请**先配好 `auth.roles`**：在登录墙后面，未登录的爬取只能走到登录页。

探索到不了从未被导航过的深层链接，也发现不了从未被触发的接口。缺的部分用结构化
补录来补，不要手改 `inventory.json`：

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

补录节点会打上 `externally-supplied` 标记并携带 `ai` / `operator` 证据，
始终和真正发现到的事实区分得开。

想知道黑盒这轮漏了多少，就和同一项目的源码基线做对比：

```bash
npm run aitest -- inventory diff --base 源码版/inventory.json --compare 黑盒版/inventory.json
```

## 运营期命令

```bash
npm run aitest -- status --project 项目名                      # 清单与覆盖率概览
npm run aitest -- auth --project 项目名 --role admin            # 登录并保存登录态

# 把一次失败运行归类为确定性的失败类型（不会自动改动任何测试）
npm run aitest -- healing --project 项目名 --run <运行ID>
npm run aitest -- trends --project 项目名                      # 通过率、覆盖率、flaky
npm run aitest -- retention --project 项目名 --max-runs 20 --dry-run
```

自愈永远不会自己改写测试：它只做失败分类，输出可审查、可回滚的提案。削弱断言或
把用例 skip 掉来「刷绿」会被直接拒绝。

## 报告树（交付给人看的东西）

`aitest run` 每次跑完自动生成（`--no-project-report` 可跳过）；单独重建用
`aitest report --by-module`（或 MCP 的 `awt_project_report`）。它固定落在
`test-output/<项目名>/report/`，`report.projectDirectory` 可以改名但改不出工作区：

```text
test-output/<项目名>/report/
  index.html              # 第一份文档：全局业务模块分析（不需要先跑测试）
  <模块名>/                # 每个被测模块一个子目录
    module.html           # 测试业务、每个步骤（含截图）、结论、发现的问题
    screenshot-001.png …  # 步骤截图就放在报告旁边，双击 HTML 也能正常显示
  未归类场景/               # 已执行但没归属到任何模块的场景，兜底保留证据
```

`index.html` 的渲染顺序固定：项目概况 → 覆盖率统计 → 模块表 → 缺陷池（按严重
程度倒序）→ 端到端流程 → 后续计划 → 验收清单 → 阶段结论。没数据的小节直接省略，
不留空壳。逐步截图需要 `run --step-screenshots`，受 `policy.allowSecretPersistence`
管控。

两个可选输入会让 `index.html` 更完整：配置里的 `metadata.overview`（项目静态事实）
和产物目录下的 `overview.json`（测试叙述）。字段见
[配置说明](docs/CONFIGURATION.md)。

## 安全控制一览

- 默认只允许 `read` 风险；创建/修改属于 `mutate`；删除、支付、退款、发送、发布属于 `destructive`；
- **保守下限**：非导航点击、表单填写至少算 `mutate`，`evaluate` 算 `destructive`——
  场景 JSON 标低了会在校验期就被拒，标签骗不过闸门；
- 破坏性动作必须同时满足风险等级、动作白名单和测试数据命名空间三个条件；
- 主机白名单默认带端口，域名白名单外的请求阻断；WebSocket 目前 fail-closed；
- 账号口令只能按环境变量名引用，不得内联进任何文件；
- 审批摘要是**防误改，不防伪造**（无密钥内容哈希）——把工作区本身当作信任边界。

完整模型见 [安全与执行策略](docs/SECURITY.md)。

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

## 参与开发

```bash
npm run typecheck   # src + tests 类型检查
npm test            # vitest run
npm run build       # tsc -> dist/
```

三条都必须通过才算改完——CI 依次执行 typecheck → playwright install → test → build，
第一步就会拦住。注意 `npm test` **不做类型检查**（vitest 只转译），所以测试全绿
不代表构建是绿的。

改动本仓库前请读 [AGENTS.md](AGENTS.md)（通用）与 [CLAUDE.md](CLAUDE.md)（详细工作笔记）。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [READINESS.md](docs/READINESS.md) | 实际可用范围与限制（启用登录态前必读） |
| [AGENT_GUIDE.md](docs/AGENT_GUIDE.md) | AI 助手协作契约 |
| [SECURITY.md](docs/SECURITY.md) | 安全模型、风险等级、审批闸门 |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | 配置文件全部字段 |
| [SCENARIOS.md](docs/SCENARIOS.md) | 场景编写 |
| [PRODUCT.md](docs/PRODUCT.md) · [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 产品需求与架构 |
| [ADAPTERS.md](docs/ADAPTERS.md) · [CI.md](docs/CI.md) | 框架适配器、CI 接入 |
| [HOW_TO_ASK_AI.md](docs/HOW_TO_ASK_AI.md) | 怎么向 AI 提测试需求 |
| [archive/](docs/archive/) | 历史过程记录（已过时，仅供追溯） |
