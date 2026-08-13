# Security and execution policy

## Default policy

The default policy is safe for an unfamiliar existing project:

- source access: read-only;
- browser discovery: navigation and observation only;
- data mutation: denied;
- destructive actions: denied;
- hosts: target base URL only;
- secret persistence: denied;
- automatic target-code changes: denied.

## Action risk levels

| Level | Meaning | Examples |
| --- | --- | --- |
| `read` | Does not intentionally change business data | navigate, URL-link click, search, filter |
| `mutate` | Creates or updates reversible test data | fill/submit forms, button click, create draft, edit profile |
| `destructive` | Deletes, pays, sends, publishes, refunds | delete, checkout, invite |

Every generated step has a risk level. A run plan states the maximum allowed
level and can further restrict actions by name or URL pattern.

The runtime validator applies conservative minimums regardless of a declared
label: form controls and non-navigation clicks require `mutate`, while
`evaluate` requires `destructive`. This prevents a mislabeled JSON scenario
from turning a read-only plan into an unreviewed state change.

## Environment safeguards

- Hostnames carrying a production marker (`prod`, `production`, `live`) are
  refused unless `allowProductionLikeHosts` is set. This is a name check, not
  environment detection — a production host that is not named like one is
  indistinguishable from staging, so pointing `baseUrl` at a test environment
  remains the operator's responsibility.
- The default host allowlist is seeded with the target's `host`, including its
  port, so an approved run cannot reach a different service on the same machine.
  A pattern written without a port still matches any port.
- Output directories must resolve inside the config's own directory. The check
  resolves symbolic links, so a directory name that redirects outside the
  workspace fails config load rather than silently writing there.
- State-changing tests require an explicit test-data namespace when supported.
- External origins are blocked unless allowlisted.
- WebSocket connections are currently blocked fail-closed because message-level
  mutation risk cannot yet be classified safely.
- Passwords, tokens, cookies, authorization headers, and configured secret keys
  are redacted in logs and AI prompts.
- Request and response bodies are not persisted by default.
- Browser traces and screenshots are disabled unless the artifact policy
  explicitly permits secret-bearing persistence.

## The approval gate

- Approval is an act by a named operator. The CLI requires an interactive
  confirmation, or `--yes` together with `--by <operator>`; MCP requires
  `confirm: true` together with a non-empty `by`. Neither has a default
  identity, and an assistant must not supply one on its own behalf.
- A preset selects scope only. It cannot carry an approval, and a config that
  tries to is rejected.
- Executing a plan that was never approved is refused as a policy decision
  (`PLAN_NOT_APPROVED`), not reported as a missing file.
- Approved plans are invalidated when their selected scenario contents, the
  inventory, the policy, or the plan body change; re-plan and re-approve after
  editing a scenario file.
- **Approval digests are tamper-evident, not tamper-proof.** They are unkeyed
  content hashes: they reliably catch an accidental edit, but anyone who can
  write the workspace can recompute them and mint a valid-looking approval.
  Where the operator of the tool is an autonomous agent with filesystem access,
  treat the workspace itself as the trust boundary.

## AI safeguards

- Source context sent to an AI provider is opt-in.
- Secret scanning and redaction run before prompt construction.
- Provider responses are untrusted input and schema-validated.
- AI cannot raise the approved risk level or add unapproved hosts.
- AI analysis is labeled as inferred unless confirmed by deterministic evidence.
