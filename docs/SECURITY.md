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
| `read` | Does not intentionally change business data | navigate, search, filter |
| `mutate` | Creates or updates reversible test data | create draft, edit profile |
| `destructive` | Deletes, pays, sends, publishes, refunds | delete, checkout, invite |

Every generated step has a risk level. A run plan states the maximum allowed
level and can further restrict actions by name or URL pattern.

## Environment safeguards

- Production indicators in hostname or configuration trigger a hard warning.
- State-changing tests require an explicit test-data namespace when supported.
- External origins are blocked unless allowlisted.
- Passwords, tokens, cookies, authorization headers, and configured secret keys
  are redacted in logs and AI prompts.
- Request and response bodies are not persisted by default.

## AI safeguards

- Source context sent to an AI provider is opt-in.
- Secret scanning and redaction run before prompt construction.
- Provider responses are untrusted input and schema-validated.
- AI cannot raise the approved risk level or add unapproved hosts.
- AI analysis is labeled as inferred unless confirmed by deterministic evidence.
