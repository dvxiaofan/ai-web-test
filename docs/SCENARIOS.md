# Scenario authoring

Generated route smoke scenarios are intentionally conservative. Teams can add
business scenarios in `scenarios.json` inside the artifact workspace or maintain
a source-controlled scenario file and copy it into that workspace during CI.

## Example

```json
{
  "schemaVersion": 1,
  "scenarios": [
    {
      "schemaVersion": 1,
      "id": "login-smoke",
      "name": "User can sign in",
      "description": "Login flow in an isolated test environment.",
      "source": "user",
      "confidence": 1,
      "moduleIds": ["module_user"],
      "routeIds": [],
      "operationIds": [],
      "roleIds": [],
      "tags": ["smoke", "critical", "auth"],
      "risk": "mutate",
      "steps": [
        {
          "id": "open-login",
          "action": "navigate",
          "risk": "read",
          "url": "/login"
        },
        {
          "id": "email",
          "action": "fill",
          "risk": "read",
          "locator": { "strategy": "label", "value": "Email" },
          "value": "${TEST_USER_EMAIL}",
          "sensitive": true
        },
        {
          "id": "submit",
          "action": "click",
          "risk": "mutate",
          "locator": { "strategy": "role", "value": "button", "name": "Sign in" }
        },
        {
          "id": "confirmation",
          "action": "assert",
          "risk": "read",
          "assertion": "visible",
          "locator": { "strategy": "role", "value": "status" }
        }
      ],
      "evidence": [],
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

Replace `module_user` with the module ID recorded in `inventory.json`; IDs are
deliberately stable but project-specific.

## Locator guidance

Prefer, in order:

1. `role` with an accessible name;
2. `label`;
3. `testId`;
4. `placeholder` or stable text;
5. CSS only when the target has no semantic locator.

The executor never silently changes a locator. A proposed self-healing change
must be reviewed and written into the scenario file.

Screenshot steps may set `baselineKey`. The runner stores a PNG snapshot and
compares its SHA-256 digest with the prior baseline. A changed digest is a
deterministic visual signal, not a semantic design judgment; dynamic content
should be masked or stabilized in the target environment before baselines are
accepted. Use `--update-baselines` only after reviewing the current screenshots.

## Risk and data

Every step has a risk. A `mutate` or `destructive` scenario will fail plan
approval unless the policy permits it and the required test-data namespace or
explicit destructive allowlist is present. Sensitive values should be written
as `${ENV_NAME}` or `env:ENV_NAME`; the executor resolves them at runtime and
does not include their values in evidence.
