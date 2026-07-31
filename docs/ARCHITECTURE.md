# Architecture

## 1. System boundaries

AI Web Test is a local-first orchestration layer. The target application remains
an independent process and repository. Generated artifacts are stored outside
the target source tree unless explicitly configured otherwise.

```text
Target source ──> Source discovery ──┐
                                    ├─> Inventory graph ─> Planner ─> Run plan
Running URL ────> Browser discovery ─┘                              │
                                                                      v
AI provider <──── redacted context ───── Triage <──── Evidence <── Runner
                                                     │
                                                     └──> HTML + JSON report
```

## 2. Major modules

### Configuration

Loads a JSON configuration, resolves paths, validates unsafe combinations, and
builds a fully explicit effective configuration. Credentials are referenced by
environment-variable name, never embedded values.

### Source discovery

- detects package manager and framework;
- walks source files with ignore rules and file/size limits;
- extracts file-based and configured routes;
- detects `fetch`, Axios, GraphQL, and common API client patterns;
- detects page, component, store, guard, and test files;
- assigns evidence, confidence, module, and source location to findings.

Framework-specific extractors are adapters; generic extraction always remains
available as a fallback.

### Runtime browser discovery

Uses Playwright in safe exploration mode to visit known entry routes and links,
capture page metadata, console errors, failed requests, API observations,
screenshots, and accessibility snapshots. Risky controls are recognized and not
activated during discovery.

### Inventory graph

The inventory is the durable contract between discovery, planning, execution,
and reporting. It records nodes (routes, pages, modules, APIs, roles, scenarios)
and typed relationships with evidence. JSON is the canonical interchange form.

### Planner and approval gate

The deterministic planner can build plans from explicit filters. An optional AI
planner can propose scenarios or improve labels, but its output is validated
against the inventory schema. A plan remains `proposed` until approved by a
person or selected from an explicitly trusted CI preset.

### Runner

Compiles approved scenario steps into Playwright actions and assertions. It
supports deterministic TypeScript specs for complex workflows and a constrained
declarative scenario format for generated flows. Runtime policy checks occur
before every mutating action.

### Evidence and reporter

Stores structured results, screenshots, traces, videos where enabled, console
events, network summaries, assertion failures, and coverage. The HTML report is
generated from the same JSON model consumed by AI assistants.

### AI adapters

AI use is optional and provider-neutral. Providers receive a redacted, bounded
context and must return schema-constrained JSON. Deterministic fallbacks remain
available for discovery, planning, execution, and reporting.

## 3. Artifact layout

By default, each target gets an isolated workspace under the tool-side
`test-output/` directory (never inside the target source tree). The workspace
root and every generated artifacts/report directory receive a self-ignoring
`.gitignore`, so target-project data cannot leak into version control:

```text
test-output/
└── <project>/
    ├── config.json           # aitest config for this target (machine-local)
    ├── artifacts/
    │   ├── inventory.json
    │   ├── overview.json
    │   ├── scenarios.json
    │   ├── plans/
    │   │   ├── proposed-<id>.json
    │   │   └── approved-<id>.json
    │   ├── generated-tests/
    │   ├── runs/<run-id>/
    │   │   ├── result.json
    │   │   ├── report.html
    │   │   ├── screenshots/
    │   │   ├── traces/
    │   │   └── logs/
    │   ├── auth/                 # saved storage states per role
    │   ├── cache/
    │   └── visual-baselines/
    └── report/               # human-facing report tree (index.html + modules)
```

Configs may still point `artifacts.directory` and `report.projectDirectory`
anywhere; the self-ignoring `.gitignore` follows the directories, not the
default names.

## 4. Execution scopes

The selector accepts full, module, route, scenario, tag, role, affected, and
failed-only filters. Dependency closure adds required authentication, shared
layout, upstream state preparation, and downstream assertions. Auto-included
dependencies are shown before approval.

## 5. Extensibility

- framework adapters implement detection and structured extraction;
- AI providers implement a small JSON request/response contract;
- reporters consume the canonical run result;
- authentication setup can be supplied as Playwright storage state or a custom
  setup scenario;
- target-specific scenarios live in user-owned files, separate from generated
  scenarios.

## 6. Reliability principles

- prefer role, label, text, and test-id locators over CSS position selectors;
- keep visual snapshot baselines in the artifact workspace and update them only
  through an explicit flag;
- use AI for suggestions and semantic review, not core financial assertions;
- preserve generated-plan provenance and confidence;
- never silently heal a test: proposed locator changes are recorded;
- classify environment failures separately from product defects;
- make every run reproducible from configuration, inventory digest, and plan.
