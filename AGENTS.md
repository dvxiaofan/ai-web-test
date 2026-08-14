# AGENTS.md

Instructions for any coding agent working **on this repository**. (For driving
the tool against a target application, read [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md)
instead — that is a different job.)

The full working notes live in [`CLAUDE.md`](CLAUDE.md) and are not duplicated
here; read that file. This page exists so agents that do not read vendor-specific
filenames still find the project's rules.

> 人类读者：项目介绍与使用说明在根目录 [`README.md`](README.md)（中文）。
> 本文件是给编码 agent 看的仓库开发约束。

## What this project is

`ai-web-test` (CLI: `aitest`) tests **other** web applications. It discovers a
target app from its source tree and/or a live URL, builds a durable inventory,
proposes a test plan, requires explicit operator approval, then executes the
plan in Playwright and emits evidence-backed reports. The tool repository and
the target application are always separate.

## The invariant that outranks everything else

> Discover first, approve a test plan second, execute state-changing tests last.

This is enforced in code, not advised. Any change must preserve it:

- `discover` navigates and observes only; it never submits forms or clicks risky
  controls.
- Approval is an act by a **named human**, never a default and never something
  an assistant grants itself. The CLI needs an interactive confirmation or
  `--yes --by <operator>`; MCP needs `confirm: true` with a non-empty `by`.
- Running an unapproved plan is refused as a policy decision
  (`PLAN_NOT_APPROVED`) — never present it as a missing file, and never create
  an `approved-*.json` to get past it.
- The default policy is `maxRisk: "read"`, no external origins, no secret
  persistence, no target code changes.
- Everything a target produces stays inside that target's workspace
  (`test-output/<project>/`), symbolic links included.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full contract.

## Definition of done

```bash
npm run build       # tsc -> dist/  (must exit 0)
npm run typecheck   # src + tests
npm test            # vitest run
```

A change is done when all three pass and the behavior has a test that fails
without the fix. `npm test` does not type-check — vitest transpiles — so a green
suite alone does not mean the build is green.

## Conventions

- **ESM + NodeNext**: relative imports carry the `.js` extension, even from `.ts`.
- **Strict TS**, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- Tests mirror the source tree: `src/<area>/x.ts` → `tests/<area>/x.test.ts`.
- CLI and MCP delegate into the same service layer — keep the two surfaces in
  sync, especially around the approval gate.
- Credentials are referenced by environment-variable name, never inline.
- Commit messages are Chinese and phase-scoped.
