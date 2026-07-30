# AI Web Test

[中文使用说明](docs/README.zh-CN.md)

AI Web Test is a reusable, agent-friendly test engineering toolkit for existing
web applications. It combines source-code discovery, browser exploration,
explicit operator approval, deterministic Playwright execution, visual evidence,
and AI-assisted planning and failure analysis.

> Alpha notice: this release is intended for controlled local or isolated test
> environments. Read [release readiness and operating boundaries](docs/READINESS.md)
> before enabling authentication or state-changing scenarios.

The project follows one safety rule above all others:

> Discover first, approve a test plan second, execute state-changing tests last.

## What is implemented

The current implementation provides:

- framework, route, API, page, and source-file discovery;
- a persistent project inventory and coverage model;
- interactive full/module/scenario test-plan selection;
- Playwright browser exploration and deterministic execution;
- HTML and JSON reports with screenshots, traces, and console/network evidence;
- deterministic visual snapshots and basic accessibility/overflow audits;
- optional AI-provider adapters for planning and failure triage;
- machine-readable CLI output for use by Codex and other AI assistants.

The only optional runtime dependency that is not needed for static discovery is
the Playwright browser bundle. If a browser or its executable is unavailable,
discovery produces a structured `unavailable` result instead of silently
claiming runtime coverage.

## Quick start

```bash
npm install
npx playwright install chromium
npm run build

# Create a config for an existing project
npm run aitest -- init ../my-web-app

# First run: source inventory + safe, observation-only browser discovery.
# Add --start only when you explicitly authorize the configured start command.
npm run aitest -- discover --config ai-web-test.config.json --start

# Generate a plan. With a terminal and no --scope this asks the operator
# whether to run smoke, a module, selected scenarios, affected coverage, or all.
npm run aitest -- plan --config ai-web-test.config.json

# Explicitly approve the proposed plan, then execute it.
npm run aitest -- approve --config ai-web-test.config.json
npm run aitest -- run --config ai-web-test.config.json
```

The sample app can be used without a framework or external backend:

```bash
cd fixtures/sample-app && npm start
# In another terminal, from ai-web-test:
npm run aitest -- discover --config examples/sample.config.json
npm run aitest -- plan --config examples/sample.config.json --scope module --module products
```

`discover` never submits forms or clicks controls. `plan` writes a proposed
plan. `approve` is the explicit execution gate. `run` refuses unapproved or
changed plans.

## Scope commands

The same inventory can be tested at different granularities:

```bash
npm run aitest -- plan --scope full
npm run aitest -- plan --scope module --module orders
npm run aitest -- plan --scope route --route <route-id>
npm run aitest -- plan --scope scenario --scenario <scenario-id>
npm run aitest -- plan --scope tag --tag smoke
npm run aitest -- plan --scope affected
npm run aitest -- plan --scope failed --failed-run <run-id>
npm run aitest -- plan --preset ci-smoke --non-interactive
npm run aitest -- run --plan <approved-plan-id>

# Accept current screenshots as visual baselines when intentionally updating UI
npm run aitest -- run --plan <approved-plan-id> --update-baselines
```

Use `--json` for AI assistants and CI. Every plan and run has a digest, so a
report can be traced back to its exact inventory, policy, scope, roles, and
browser profiles.

## Targets without source access (black-box)

Static discovery needs a source tree. When only a URL and credentials are
available, switch the target to `runtime-first`: the inventory is seeded from
`baseUrl` and filled in by browser exploration instead of AST analysis.

```jsonc
{
  "target": {
    "baseUrl": "https://app.example.com",   // required in this mode
    "discovery": "runtime-first",
    "seedPaths": ["/login", "/orders"]       // optional extra entry points
  }
}
```

```bash
npm run aitest -- discover --config aitest.config.json
# or, without touching the config:
npm run aitest -- discover --config aitest.config.json --runtime-only
```

Configure `auth.roles` first: behind a login wall an unauthenticated crawl only
ever reaches the login page.

Exploration cannot reach deep links that were never navigated to, nor APIs that
were never triggered. Top the inventory up with a structured supplement instead
of hand-editing `inventory.json`:

```jsonc
// supplement.json
{
  "source": "ai",
  "modules": [
    { "name": "Ticket square", "description": "public ticket pool",
      "routes": ["/square"], "apis": [{ "method": "GET", "path": "/api/square" }] }
  ],
  "routes": [{ "path": "/profile", "module": "Account", "requiresAuth": true }]
}
```

```bash
npm run aitest -- inventory merge --config aitest.config.json --file supplement.json
```

Merged nodes are tagged `externally-supplied` and carry `ai`/`operator`
evidence, so they stay distinguishable from discovered facts. Invalid entries
are skipped and reported as warnings rather than failing the batch.

To measure what a black-box pass missed, compare it against a source-derived
baseline for the same target:

```bash
npm run aitest -- inventory diff --base static/inventory.json --compare blackbox/inventory.json
```

The diff matches nodes by business identity (module name, route path,
method + path) rather than node id, and reports per-kind recall plus the exact
missing and extra entries.

## AI assistant integration

AI Web Test is useful with an external AI assistant even when no model API is
configured. The assistant can call the CLI, inspect `inventory.json`, proposed
plans, run `result.json`, and the HTML report. A provider can optionally be
enabled for scenario proposals and failure triage:

```json
{
  "ai": {
    "enabled": true,
    "provider": "openai-responses",
    "model": "<configured-model>",
    "apiKeyEnv": "OPENAI_API_KEY",
    "sendSource": false,
    "sendScreenshots": false
  }
}
```

Source and screenshot sharing are opt-in. Source prompts are bounded and use
inventory-referenced excerpts; provider responses are validated and cannot
increase the approved action risk or host allowlist.

```bash
npm run aitest -- ai-plan --config ai-web-test.config.json
npm run aitest -- analyze --config ai-web-test.config.json --run <failed-run-id>
```

`analyze` sends screenshot bytes only when `ai.sendScreenshots` is explicitly
enabled.

## Intended workflow

```text
inspect source + observe runtime
              ↓
       build inventory
              ↓
       propose test plan
              ↓
       operator approval
              ↓
        execute safely
              ↓
     evidence + coverage report
```

See [release readiness](docs/READINESS.md), [Product requirements](docs/PRODUCT.md),
[Architecture](docs/ARCHITECTURE.md), and
[Implementation plan](docs/IMPLEMENTATION_PLAN.md). Additional references:
[configuration](docs/CONFIGURATION.md), [scenario authoring](docs/SCENARIOS.md),
[security](docs/SECURITY.md), [AI assistants](docs/AGENT_GUIDE.md), and
[CI](docs/CI.md).

## Project report tree (human-facing)

When a human-readable deliverable is needed, `aitest report --by-module` (or the
MCP tool `awt_project_report`) builds a self-contained `test-<project>` directory
next to the artifact workspace:

```text
test-<project>/
  index.html              # first document: global business-module analysis
  <module>/               # one subdirectory per tested module
    module.html           # business, steps (each with screenshot), result, problems
    screenshot-001.png …  # step screenshots copied next to the report
```

- `index.html` is the required first document: it lists every discovered
  business module with its routes/pages/APIs/scenarios and links to each module
  report. Generated from `inventory.json` (no run required). It renders, in
  order: project facts, coverage stats, the module table, the defect pool
  (findings from `inventory.json` plus the latest run, worst severity first),
  end-to-end flows, next steps, the acceptance checklist and staged
  conclusions. Sections without data are omitted rather than left empty.

### Feeding the overview

Two inputs enrich `index.html`; both are optional.

**Static project facts** — `metadata.overview` in the config. These are inputs
that only change when the target changes:

```jsonc
{
  "metadata": {
    "overview": {
      "intro": "IT service ticketing platform",
      "techStack": "Vue 3 + Spring Boot",
      "conventions": ["read-only account must not submit tickets"],
      "businessSystems": ["ITR-GD", "ITR-SZ"],
      "accounts": [{ "role": "admin", "note": "injected from env" }]
    }
  }
}
```

**Test narrative** — `overview.json` in the artifact directory, written during
testing and read automatically by `report` / `awt_project_report`:

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-30T00:00:00.000Z",
  "e2eFlows": [
    { "name": "create → assign → close", "steps": ["create", "assign", "close"],
      "status": "passed", "scenarioIds": ["sc_1"] }
  ],
  "nextSteps": [{ "priority": "high", "text": "cover the permission matrix" }],
  "acceptance": [{ "item": "smoke passes on every module", "done": false }],
  "conclusions": [{ "at": "2026-07-30T00:00:00.000Z", "text": "first regression done" }]
}
```
- Each tested module gets its own subdirectory containing `module.html`. The
  report describes the test business, every step (with an inline screenshot when
  `--step-screenshots` was used during `run`), the final result, and any problems
  found. Modules with no executed scenarios are omitted.
- Override the directory with `report.projectDirectory` in the config.

Per-step screenshots require `run --step-screenshots`, which is gated by
`policy.allowSecretPersistence`.

## Repository layout

```text
src/core/          durable schemas, policy, config, artifacts
src/discovery/     source walker, framework/routes/API analysis
src/browser/       safe runtime exploration and evidence capture
src/planning/      scope selection, dependency closure, approval gate
src/execution/     Playwright scenario executor
src/reporting/     HTML and machine-readable result reports
src/ai/            provider-neutral planning and triage adapters
fixtures/          self-contained sample target application
tests/             unit and integration tests for the tool
docs/              design, security, configuration, and agent guidance
```
