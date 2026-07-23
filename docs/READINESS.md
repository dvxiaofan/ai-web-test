# Release readiness and operating boundaries

The repository currently targets **alpha / v0.1**. It is useful as a reusable
discovery and declarative smoke-testing foundation, but it is not a drop-in
replacement for a test team or a permission boundary around an arbitrary web
application.

## Safe, supported use today

- Static source discovery and an auditable inventory of routes, pages, APIs,
  modules, roles, and likely coverage gaps.
- Observation-only browser exploration against a local or explicitly isolated
  test host.
- Manually authored, approved, read-only scenarios with stable locators and
  deterministic assertions.
- CI execution when the target, browser, credentials, data namespace, and
  approved plan are controlled by the project owner.
- Machine-readable artifacts that an AI assistant can inspect and summarize.

## Preconditions for a real project

Before enabling browser execution, the operator should verify:

1. The target URL points to an isolated test environment, never production.
2. The configured host allowlist contains only the intended origins.
3. Authentication state is generated for test accounts and stored outside source
   control.
4. Mutating scenarios use disposable, namespaced data and have an explicit
   cleanup strategy.
5. An operator reviews and approves the generated plan and scenario contents.
6. Artifacts are stored in a protected location and retention is configured for
   the project's privacy requirements.

## Not yet a release claim

The following remain experimental or require additional project-specific work:

- Automatically converting AI proposals into executable business scenarios.
- Unattended mutation, deletion, payment, publishing, or messaging flows.
- Login setup from `usernameEnv` / `passwordEnv` without a prebuilt Playwright
  storage state.
- Complete business-rule inference, 100% route coverage, or semantic visual
  correctness.
- Running against an untrusted repository with automatic target startup.

The plan approval digest, runtime request guard, scenario schema validation, and
non-zero CI exit behavior are safety prerequisites rather than optional polish.
If any of these checks fail, the run should stop and require a new plan or an
operator decision.

The alpha repository does not yet contain `package-lock.json`; generate and
commit it before treating installs as reproducible or switching CI to `npm ci`.

## Suggested adoption path

Start with `discover --static-only`, then observation-only `discover`, followed
by a `smoke` plan containing read-only scenarios. Add one module at a time,
review evidence and unresolved coverage, and only then consider a dedicated
test-data namespace for reversible mutations. Keep destructive workflows in a
separate, explicitly approved project configuration.
