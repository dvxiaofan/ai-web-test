# AI assistant guide

This document is the contract for Codex, a CI agent, or another tool-using
assistant that operates AI Web Test.

## Safe operating loop

1. Read the target config and verify the base URL is a test environment.
   Configs live at `test-output/<project>/config.json`; every command accepts
   `--project <name>` as shorthand for that path.
2. Run `aitest discover --project <name> --json`.
3. Read `inventory.json` and summarize discovered pages, APIs, roles, findings,
   and unresolved items.
4. Ask the operator to choose or confirm a scope unless a named CI preset was
   explicitly supplied.
5. Run `aitest plan --scope ... --json`.
6. Show plan scope, auto-included dependencies, risk level, hosts, roles,
   browsers, and expected mutations.
7. Run `aitest approve --plan ...` only after explicit approval. Approval needs a
   human and a name: interactively, answer the prompt; non-interactively, pass
   `--yes --by <operator>`. Over MCP, `awt_approve` requires `confirm: true`
   together with `by`. **Neither has a default identity — do not supply one on
   your own behalf.** In CI, use a checked-in plan or a trusted preset; never
   infer approval from a passing discovery step.
8. Run `aitest run --plan ... --json`. Running a plan nobody approved is refused
   with `PLAN_NOT_APPROVED`. That is a policy decision, not a broken file: go
   back to step 7, and never create an `approved-*.json` yourself.
9. Read `runs/<run-id>/result.json`, screenshots, traces, and report HTML.
10. If an AI provider is configured, optionally run `aitest analyze --run ...`.
11. Classify failures as confirmed, probable, environment, data, flaky, or
    unresolved. Do not edit the target project automatically.
12. Produce the human-facing deliverable with `aitest report --by-module`
    (or MCP `awt_project_report`). `aitest run` already builds this tree at the
    end of every run, so this step is a rebuild rather than a first build.
    Its output structure is a hard contract:
    - The report directory (`test-output/<project>/report/`) MUST have
      `index.html` as its first document — the global analysis of every
      discovered business module.
    - Each tested module MUST get its own subdirectory named after the module,
      containing `module.html` (business, steps with inline screenshots, final
      result, and problems found).
    - Screenshots MUST live inside the module subdirectory so the HTML displays
      them when opened directly.
    - For step screenshots, the operator must run `aitest run --step-screenshots`
      (gated by `policy.allowSecretPersistence`); modules with no executed
      scenarios are omitted from the tree.
13. Run `aitest doctor` (or MCP `awt_doctor`) before handing off. It exits
    non-zero when a target-specific file leaked outside the workspace, an output
    directory escapes the workspace (including through a symbolic link), the
    report tree is missing or carries no module report despite existing runs, or
    a workspace file contains a plaintext credential. In `--json`, read
    `healthy` — the envelope's `ok` only means the command ran.

## The output workspace is a hard contract

Everything about a target lives in that target's workspace, and nothing else
does. The workspace root is the directory holding its `config.json`:

```
test-output/<project>/
  config.json
  artifacts/   inventory, scenarios, plans, runs
  report/      index.html + one subdirectory per tested module
  docs/        hand-written analysis — the only legal home for it
  scripts/     target-specific one-off scripts — likewise
```

- `artifacts.directory` and `report.projectDirectory` must resolve inside the
  config's own directory; a path that escapes it makes the config fail to load.
- Every `--json` result carries a `workspace` block with these absolute paths.
  **Read it instead of guessing.** Any file you write by hand for a target — an
  analysis note, a scenario summary, an exploration script — goes in that
  target's `docs/` or `scripts/`. Never write it beside the tool's own source,
  and never into the target's source tree.
- Reference credentials by environment-variable name. Never inline a password,
  token, or cookie into a file you write, even inside the workspace.

## Required assistant behavior

- Treat `unresolved`, `blocked`, and `unavailable` as visible outcomes.
- Never describe inferred scenarios as verified business rules.
- Do not raise `maxRisk`, add hosts, or allow destructive actions without a new
  operator-approved plan.
- Prefer a narrower reproducible rerun (`--module`, `--scenario`, or `--failed`)
  before proposing a full regression.
- Include the plan ID, run ID, inventory digest, and evidence paths in reports.

## Useful JSON fields

- `inventory.coverage`: independent route/page/API/role/scenario coverage.
- `plan.scope`: exactly what was selected.
- `plan.autoIncludedScenarioIds`: dependencies added by graph closure.
- `result.status`: overall execution state.
- `result.scenarios[*].steps[*].assertions`: deterministic proof.
- `result.coverage.unresolvedIds`: items not verified.
