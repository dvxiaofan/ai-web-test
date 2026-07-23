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

- Production indicators in hostname or configuration trigger a hard warning.
- State-changing tests require an explicit test-data namespace when supported.
- External origins are blocked unless allowlisted.
- WebSocket connections are currently blocked fail-closed because message-level
  mutation risk cannot yet be classified safely.
- Passwords, tokens, cookies, authorization headers, and configured secret keys
  are redacted in logs and AI prompts.
- Request and response bodies are not persisted by default.
- Browser traces and screenshots are disabled unless the artifact policy
  explicitly permits secret-bearing persistence.
- Approved plans are invalidated when their selected scenario contents change;
  re-plan and re-approve after editing a scenario file.

## AI safeguards

- Source context sent to an AI provider is opt-in.
- Secret scanning and redaction run before prompt construction.
- Provider responses are untrusted input and schema-validated.
- AI cannot raise the approved risk level or add unapproved hosts.
- AI analysis is labeled as inferred unless confirmed by deterministic evidence.
