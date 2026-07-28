# AI assistant guide

This document is the contract for Codex, a CI agent, or another tool-using
assistant that operates AI Web Test.

## Safe operating loop

1. Read the target config and verify the base URL is a test environment.
2. Run `aitest discover --json`.
3. Read `inventory.json` and summarize discovered pages, APIs, roles, findings,
   and unresolved items.
4. Ask the operator to choose or confirm a scope unless a named CI preset was
   explicitly supplied.
5. Run `aitest plan --scope ... --json`.
6. Show plan scope, auto-included dependencies, risk level, hosts, roles,
   browsers, and expected mutations.
7. Run `aitest approve --plan ...` only after explicit approval. In CI, use a
   checked-in plan or a trusted preset; never infer approval from a passing
   discovery step.
8. Run `aitest run --plan ... --json`.
9. Read `runs/<run-id>/result.json`, screenshots, traces, and report HTML.
10. If an AI provider is configured, optionally run `aitest analyze --run ...`.
11. Classify failures as confirmed, probable, environment, data, flaky, or
    unresolved. Do not edit the target project automatically.
12. Produce the human-facing deliverable with `aitest report --by-module`
    (or MCP `awt_project_report`). Its output structure is a hard contract:
    - The top-level `test-<project>` directory's first document MUST be
      `index.html` — the global analysis of every discovered business module.
    - Each tested module MUST get its own subdirectory named after the module,
      containing `module.html` (business, steps with inline screenshots, final
      result, and problems found).
    - Screenshots MUST live inside the module subdirectory so the HTML displays
      them when opened directly.
    - For step screenshots, the operator must run `aitest run --step-screenshots`
      (gated by `policy.allowSecretPersistence`); modules with no executed
      scenarios are omitted from the tree.

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
