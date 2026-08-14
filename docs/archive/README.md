# 历史归档

这个目录存放**过程记录**，不是当前文档。它们记录了项目某个阶段的状态，
写下之后就没有再随代码更新过。

**读之前先知道两件事：**

1. 这里的结论、计数、文件路径都可能已经过时。以 `src/` 的实际代码、
   [`../ARCHITECTURE.md`](../ARCHITECTURE.md)、[`../SECURITY.md`](../SECURITY.md)
   和根目录 [`README.md`](../../README.md) 为准。
2. 前三份记录引用的方案文件 `AI测试工具最终合并执行方案-codex.md`
   **不在本仓库内**（它在仓库的父目录）。clone 本仓库的人拿不到它，
   所以那些引用是悬空的。

| 文件 | 内容 | 时间 |
| --- | --- | --- |
| [`全仓测试记录.md`](全仓测试记录.md) | Phase 0–6 的全仓测试用例记录 | 2026-07-28 |
| [`全仓测试记录-中文版.md`](全仓测试记录-中文版.md) | 上一份的中文自动翻译版，内容重复 | 2026-07-28 |
| [`Phase6测试记录.md`](Phase6测试记录.md) | Phase 6（安全自愈 + 长期运营）的用例记录 | 2026-07-28 |
| [`PROJECT_RISKS-M3.md`](PROJECT_RISKS-M3.md) | M3 里程碑的风险登记 | M3 期间 |
| [`better-harness-findings.md`](better-harness-findings.md) | 第三方工具 Better Harness 的仓库体检报告，**含已证伪结论，见下** | 2026-08-10 |

## 关于 better-harness-findings.md

这份报告由第三方工具 `@qoder/better-harness` v0.5.0 自动生成。2026-08-13
逐条核实后，**其中两条结论不成立**：

- **"`agentInstructions.count = 0`，agent 规范仅散落在 workflow yml"** —— 不成立。
  仓库根有 `CLAUDE.md`、`AGENTS.md`，`docs/` 下有完整的 `AGENT_GUIDE.md`。
  该工具只匹配 `AGENTS.md` 这一个字面文件名，据此断言"零 agent 指令"。
- **"高置信核心文件包含 `core/planner.ts`"** —— 该路径不存在（实际是
  `src/planning/`）。

其余结论（缺 `AGENTS.md`、缺依赖自动更新、git 历史仅 18 天、lockfile 存在）
经核实属实，其中"补 `AGENTS.md`"和"启用 Dependabot"两条已采纳落地。
它建议的"闭环验证证据"一条是范畴错误——该工具自己声明不运行测试、不查 CI，
却把自身盲区记成了项目缺陷；本仓库的 CI 实际执行
`typecheck → playwright install → test → build` 四步。
