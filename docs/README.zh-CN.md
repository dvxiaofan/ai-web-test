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
（清单、计划、运行记录）和 `report/`（人类可读报告）。`--project <项目名>`
是 `--config test-output/<项目名>/config.json` 的简写。`test-output/` 整体
被 git 忽略，工具还会在每个产物目录内自动写入自忽略的 `.gitignore`，
确保被测项目的数据（截图、内网地址、登录态）不会进入版本库。

如果执行 `plan` 时没有传入范围，工具会询问操作者选择：

- 核心冒烟测试；
- 一个或多个业务模块；
- 指定业务场景；
- 根据 Git 代码变更选择受影响范围；
- 全量回归。

## 按模块测试

```bash
npm run aitest -- plan --scope module --module order
npm run aitest -- plan --scope module --module user-center
```

模块选择会自动加入登录、数据准备等已知前置依赖，并在计划中列出自动加入
的场景和原因。

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

## AI助手使用

Codex 等 AI 助手应使用 `--json`，读取以下产物：

```text
test-output/<项目名>/
├── config.json
├── artifacts/
│   ├── inventory.json
│   ├── scenarios.json
│   ├── plans/
│   └── runs/<run-id>/
│       ├── result.json
│       ├── report.html
│       ├── screenshots/
│       └── traces/
└── report/
```

完整字段参考 [配置说明](CONFIGURATION.md)、[AI助手指南](AGENT_GUIDE.md)、
[场景编写](SCENARIOS.md) 和 [安全模型](SECURITY.md)。
