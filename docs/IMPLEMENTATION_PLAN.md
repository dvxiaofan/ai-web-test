# Implementation plan

Implementation status as of 2026-07-23: milestones 1–5 are implemented in the
repository. Browser end-to-end execution is covered by an opt-in fixture test
(`AI_WEB_TEST_E2E=1`); environments that forbid local listeners should run the
unit/integration suite and execute the fixture in CI.

## Milestone 1: foundation ✅

- Node/TypeScript CLI and configuration validation.
- Canonical inventory, scenario, plan, policy, and result schemas.
- Artifact workspace and deterministic identifiers.
- Commands: `init`, `discover`, `plan`, `approve`, `run`, `report`.

## Milestone 2: static discovery ✅

- Framework and package-manager detection.
- Generic source walker with ignore rules.
- React, Vue, Next, and Nuxt route discovery.
- Fetch, Axios, and GraphQL operation discovery.
- Page/component/store/guard categorization.
- Module inference and inventory coverage report.

## Milestone 3: runtime discovery and execution ✅

- Safe Playwright exploration.
- Console, network, screenshot, and trace evidence.
- Declarative scenario executor.
- Full/module/route/scenario/tag/role selectors.
- Interactive approval gate and immutable approved plans.

## Milestone 4: AI assistance ✅

- Provider-neutral schema-constrained adapter.
- Scenario proposal from inventory and selected source summaries.
- Semantic screenshot review integration point.
- Failure classification and actionable triage.
- Machine-readable agent protocol and example assistant instructions.

## Milestone 5: quality and distribution ✅

- Unit, integration, and end-to-end fixtures.
- Self-test against the included sample application.
- HTML/JSON reports and CI summary.
- CI templates, Docker guidance, and package publishing metadata.
- Full quick-start, configuration, adapter, agent, and troubleshooting docs.

## Acceptance gates

Each milestone must type-check, pass its tests, and include a runnable example.
The final end-to-end test must demonstrate:

1. discovering a fixture application;
2. producing an inventory;
3. proposing and approving a module-scoped plan;
4. executing it in a browser;
5. reporting pass/fail evidence and uncovered items.
