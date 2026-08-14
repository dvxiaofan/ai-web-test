# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ai-web-test` (CLI: `aitest`) is a Node/TypeScript toolkit that tests **other**
web applications. It discovers a target app from its source tree and/or a live
URL, builds a durable inventory, proposes a test plan, requires explicit
operator approval, then executes the plan in Playwright and emits evidence-backed
reports. The tool repository and the target application are always separate.

The repo root is `ai-web-test/`. Its parent directory (`test_code/`) holds
planning docs (`AI测试工具*执行方案*.md`) and `_legacy-reference/` — historical
context, not code.

## Commands

```bash
npm install
npx playwright install chromium     # only needed for browser discovery/execution

npm run build          # tsc -> dist/ (required before `npm run aitest`)
npm run typecheck      # tsc -p tsconfig.test.json --noEmit  (src + tests)
npm test               # vitest run
npm run test:watch
npm run dev -- <args>  # tsx src/cli.ts — run the CLI without building
npm run clean

npm run aitest -- <command>   # runs dist/cli.js; needs a prior build
```

Single test file / single case:

```bash
npx vitest run tests/planning/approval.test.ts
npx vitest run -t "rejects a changed plan"
```

Browser E2E against `fixtures/sample-app` is skipped unless opted in:

```bash
AI_WEB_TEST_E2E=1 npx vitest run tests/e2e/sample-app.test.ts
```

CI (`.github/workflows/ai-web-test.yml`) runs `typecheck → playwright install
chromium → npm test (AI_WEB_TEST_E2E=1) → build`. Node is pinned by `.nvmrc` (22).

## The safety invariant

> Discover first, approve a test plan second, execute state-changing tests last.

This is not advice — it is enforced in code, and any change must preserve it:

- `discover` navigates and observes only; it never submits forms or clicks risky
  controls (`src/browser/risk.ts`).
- `plan` writes a `proposed-<id>.json`; `approve` writes `approved-<id>.json`;
  `run` refuses anything unapproved with `PLAN_NOT_APPROVED` — a policy refusal,
  never a missing-file error, so no caller mistakes it for something to repair.
- Approval is an act by a **named operator**, never a default. CLI: interactive
  confirmation, or `--yes` together with `--by <operator>`. MCP: `confirm: true`
  together with a non-empty `by`. Presets select scope and can never carry an
  approval.
- Approval is bound by **digests** (`src/planning/approval.ts`,
  `src/core/ids.ts`): plan contents, inventory, policy, and the exact selected
  scenario definitions. Editing a scenario file invalidates the approval and
  forces re-plan + re-approve. The digests are unkeyed, so they are
  tamper-*evident*, not tamper-proof — anyone who can write the workspace can
  recompute them.
- `DEFAULT_TEST_POLICY` (`src/core/policy.ts`) is `maxRisk: "read"`, no external
  origins, no secret persistence, no target code changes. Risk levels are
  `read | mutate | destructive`. The default host allowlist keeps the target's
  port, so an approved run cannot wander to another service on the same box.
- The runtime validator applies **conservative minimums regardless of a declared
  label**: form controls and non-navigation clicks require `mutate`, `evaluate`
  requires `destructive`. A mislabeled JSON scenario cannot escalate a read-only
  plan.
- AI provider output is untrusted input: schema-validated, and it can never raise
  `maxRisk` or add hosts (`src/ai/`, `src/scenarios/validator.ts`).
- Target startup (`target.startCommand`) only runs with an explicit `--start`.

See `docs/SECURITY.md` and `docs/AGENT_GUIDE.md` for the full contract.

## Architecture

```
target source ──> src/discovery  ─┐
                                  ├─> Inventory ──> src/planning ──> approved plan
live URL ───────> src/browser  ───┘   (the contract)                      │
                                                                          v
      report tree <── src/reporting <── evidence <── src/execution (Playwright)
                                            │
                                            └──> src/ai (advisory triage/planning)
```

**The inventory is the durable contract** between every stage. It is a typed
node/edge graph (`Inventory` in `src/core/types.ts`) of modules, routes, pages,
components, APIs, roles, scenarios, stores, guards, and tests — each node
carrying `EvidenceRef` (`source | runtime | operator | ai | artifact`) and a
confidence score. Discovery, planning, execution, and reporting all speak this
JSON; nothing downstream reads the target source directly.

### Module map (`src/`)

`src/cli.ts` is the single command dispatcher (`init, discover, plan, ai-plan,
approve, run, report, analyze, status, doctor, auth, mcp, healing, trends,
retention, inventory`); `src/mcp/` exposes the same operations as `awt_*` MCP
tools over stdio. Both delegate into the same service layer — keep them in sync.
`aitest mcp` serves **one target**: it resolves `--config` / `--project` at
startup and refuses to start without an existing config.

| Path | Role |
| --- | --- |
| `core/` | `types.ts` (all durable schemas), `config.ts`, `policy.ts`, `artifacts.ts`, `ids.ts` (stable digests) |
| `discovery/` | source walker, framework detection, route/API/AST extraction → inventory |
| `browser/` | safe Playwright exploration, host policy, risk classification, role/menu explorers |
| `inventory/` | coverage, queries, `runtime-merge` (black-box), `external-merge` (operator/AI supplements), `diff` |
| `business/` | Phase-4 **Business Inventory**: entities, actions, rules, permissions, state machines. A *separate* domain layer sharing core ids (`moduleId`/`routeId`/…) so it does not pollute the core node union |
| `planning/` | scope selectors, dependency closure, `approval.ts` (the gate) |
| `scenarios/` | generation, dedup, import, proposals, JSON schema validation |
| `execution/` | `executor.ts`, action compiler, assertion runner, evidence collector, visual snapshots, controlled-Spec adapter + static validator |
| `reporting/` | `html.ts`, `markdown.ts`, `project-report.ts` (the by-module tree), `zh-CN.ts` |
| `ai/` | provider-neutral adapters, redaction, bounded source context, triage |
| `auth/` | role login via UI / API / storage-state / custom adapters |
| `healing/` | deterministic failure classification, semantic diff, auditable fix *proposals* (never auto-applied) |
| `history/` | trends, flaky detection, artifact retention |
| `agent/` | project lifecycle state machine (`initialized → discovered → plan_proposed → plan_approved → running → completed/failed`) |
| `testdata/`, `runtime/` | namespaced test data + cleanup; target process supervision |

### The workspace is a hard contract

Every target gets one isolated workspace. **Everything about a target lives in
it, and nothing else does** — never in this repo, never in the target source
tree. The workspace root is the directory holding that target's `config.json`.

```
test-output/<project>/
  config.json      # `--project <name>` == `--config test-output/<name>/config.json`
  artifacts/       # inventory.json, overview.json, scenarios.json, plans/, runs/<id>/, auth/, cache/, visual-baselines/
  report/          # human-facing tree: index.html + one subdirectory per tested module
  docs/            # hand-written analysis — the only legal home for it
  scripts/         # target-specific one-off scripts — likewise
```

This is enforced, not advised:

- `artifacts.directory` and `report.projectDirectory` must resolve inside the
  config's own directory. A path that escapes it is a `workspace` validation
  issue and **the config fails to load** (`validateWorkspacePath` in
  `src/core/config.ts`), so no command can write outside the workspace. The
  check at load time resolves symbolic links (`isInsideDirectoryReal`), so a
  directory name that redirects outside the workspace is rejected too.
- `ArtifactStore` re-checks containment on every write (`isInsideDirectory` in
  `src/core/artifacts.ts` — the same predicate both layers share).
- Every JSON result carries a `workspace` block with the absolute paths
  (`src/core/workspace.ts`, surfaced via `CliOutput.setWorkspace`). Read it
  instead of guessing where a file belongs.
- `aitest doctor` / `awt_doctor` audits what static checks cannot reach:
  target-specific files that leaked into this repo, output directories that
  escape through a symlink, a missing report tree, a report tree with no module
  report despite existing runs, and plaintext credentials in workspace files. It
  exits non-zero on any error. In `--json` the audit verdict is `healthy`; the
  envelope's `ok` only means the command ran.

When you write a scenario summary, an exploration script, or any other file for
a target by hand, it goes in that target's `docs/` or `scripts/` — never beside
the tool's own source.

A self-ignoring `.gitignore` is written into `test-output/` and into every
directory the tool creates, so outputs stay untracked wherever the workspace is.

### Report tree is a hard contract

`aitest run` builds the tree automatically at the end of every run (opt out with
`--no-project-report`); `aitest report --by-module` / `awt_project_report`
rebuilds it. It must produce `index.html` first (global analysis of every
discovered business module, generated from `inventory.json`, no run required),
then one subdirectory per **tested** module containing `module.html` with
screenshots stored beside it so the HTML works when opened directly. Modules
with no executed scenarios are omitted; empty sections are omitted rather than
rendered blank. Executed scenarios that belong to no module land in a `未归类场景`
directory rather than being dropped — a run must never pass while delivering an
empty tree. Per-step screenshots require `run --step-screenshots`, gated by
`policy.allowSecretPersistence`. Report-tree failures surface as warnings and
never mask the run's own status or exit code.

## Code conventions

- **ESM + NodeNext**: relative imports must carry the `.js` extension
  (`import ... from "./types.js"`), even for `.ts` sources.
- **Strict TS**, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` — indexed access yields `T | undefined`, and an
  optional property cannot be explicitly assigned `undefined`. Build with
  `tsconfig.json` (`src` only); typecheck tests with `tsconfig.test.json`.
- Tests mirror the source tree: `src/<area>/x.ts` → `tests/<area>/x.test.ts`.
- Config paths resolve relative to the **config file**, not the shell cwd.
- Credentials are referenced by environment-variable name
  (`auth.roles[].passwordEnv`, `ai.apiKeyEnv`), never as inline values.
- `schema/ai-web-test.config.schema.json` is the editor-facing config schema —
  update it alongside `src/core/config.ts`.
- Surface `unresolved` / `blocked` / `unavailable` as real outcomes. Missing
  Playwright must yield a structured `unavailable` result, never a silent claim
  of runtime coverage.
- Commit messages in this repo are Chinese and phase-scoped, e.g.
  `Phase10: 产物工作区彻底隔离 test-output/<项目>/{...} + --project 简写`.
