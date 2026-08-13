# Product requirements

## 1. Purpose

AI Web Test turns an existing web project into a measurable, repeatable UI and
business-flow test program. It is intended to be invoked both by people and by
AI assistants. It must never confuse inferred behavior with verified behavior.

## 2. Primary use cases

1. Point the tool at a local source repository and optionally a running URL.
2. Discover framework, routes, pages, APIs, roles, components, and likely flows.
3. Produce an auditable inventory with confidence and evidence for every item.
4. Propose full, module, scenario, smoke, affected, or failed-only test plans.
5. Require operator approval before state-changing browser actions.
6. Execute approved plans in real browsers and collect deterministic evidence.
7. Use an optional AI provider to enhance planning, visual review, and triage.
8. Produce human-readable and machine-readable coverage and failure reports.

## 3. Non-goals

- Claiming 100% knowledge of undocumented business rules.
- Running destructive workflows against production by default.
- Replacing deterministic assertions with probabilistic visual judgment.
- Automatically fixing the target application without separate authorization.
- Storing credentials in project configuration or generated reports.

## 4. User-visible modes

### Discover

Read source files and safely observe a running application. This mode creates or
updates the inventory; it does not submit risky forms or invoke destructive
actions.

### Plan

Convert inventory items into a proposed run plan. The operator can select:

- all discovered coverage;
- one or more business modules;
- one or more routes or scenarios;
- smoke or critical tags;
- code-change-affected coverage;
- previously failed tests.

### Approve

Confirm environment, roles, browser profiles, mutation level, destructive-action
policy, test-data strategy, and selected scope. Approval is saved as a versioned
run-plan artifact.

### Run

Execute only the approved plan. Every run records the exact plan digest so its
scope can be reproduced.

### Analyze and report

Correlate assertions, screenshots, browser traces, console output, network
requests, inventory coverage, and optional AI observations. Reports distinguish
confirmed failures, probable defects, environmental failures, flaky behavior,
and coverage gaps.

## 5. Safety requirements

- First run defaults to `discover` and `plan`; never implicit full execution.
- Every run defaults to read-only. Raising `maxRisk` is a deliberate config
  change, and hosts whose name carries a production marker (`prod`,
  `production`, `live`) are refused outright unless explicitly allowlisted.
  This is a name check, not environment detection: a production host that is not
  named like one — `www.example.com` — is indistinguishable from staging, so the
  operator remains responsible for pointing `baseUrl` at a test environment.
- Actions are classified as read-only, reversible mutation, or destructive.
- Destructive actions require a plan-level opt-in and an action allowlist.
- Approval is an act by a named operator, not a config value. A preset selects
  scope; it can never carry an approval, and no interface — CLI or MCP — grants
  one without an explicit confirmation and an approver identity.
- Secrets come from environment variables and are redacted from artifacts.
- Every excluded, blocked, or uncertain inventory item appears in the report.
- CI has no interactive prompt; it must receive a previously approved plan or a
  safe named preset.

## 6. Definition of coverage

The tool reports multiple independent dimensions rather than one misleading
percentage:

- routes discovered / visited;
- pages discovered / rendered successfully;
- API operations discovered / observed / asserted;
- roles configured / exercised;
- business scenarios proposed / approved / passed;
- viewport and browser profiles executed;
- source modules mapped to at least one scenario;
- unresolved and inaccessible items with reasons.

## 7. Success criteria

A first-time user can configure a target, generate an inventory, approve a
module-scoped plan, run it, and open a report without changing tool source code.
An AI assistant can perform the same workflow through stable CLI commands and
JSON artifacts, while approval remains visible and enforceable.
