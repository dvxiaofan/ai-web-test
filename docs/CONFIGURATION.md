# Configuration reference

Configuration is JSON so it can be generated and consumed by any agent. Paths
are resolved relative to the configuration file, not the shell's current
directory.

Editors can use [`schema/ai-web-test.config.schema.json`](../schema/ai-web-test.config.schema.json)
for completion and basic validation.

## Workspace layout and config location

`aitest init` creates one workspace per target: `test-output/<project>/` with
`config.json`, `artifacts/`, `report/`, `docs/`, and `scripts/` inside. Every
CLI command accepts `--project <name>` as shorthand for
`--config test-output/<name>/config.json`.

Defaults when fields are omitted:

- `artifacts.directory` → `test-output/<project-slug>/artifacts`, resolved
  relative to the config file (never inside the target source tree);
- `report.projectDirectory` → a `report` directory beside the artifact
  workspace.

**Both paths must resolve inside the directory holding the config file.** A path
that escapes it is rejected with a `workspace` validation issue and the config
fails to load, so a target's outputs can never be written elsewhere. `docs/` and
`scripts/` are where hand-written analysis and target-specific one-off scripts
belong; `aitest doctor` reports files that ended up outside the workspace.

The tool writes a self-ignoring `.gitignore` into `test-output/` and into every
directory it creates, so generated outputs (screenshots, traces, storage states,
internal URLs) stay out of version control regardless of where the directories
are placed.

## Minimal configuration

```json
{
  "project": { "name": "my-app" },
  "target": {
    "rootDir": "../my-app",
    "baseUrl": "http://127.0.0.1:3000",
    "startCommand": "npm run dev"
  }
}
```

## Complete shape

```json
{
  "schemaVersion": 1,
  "project": { "id": "optional-stable-id", "name": "my-app" },
  "target": {
    "rootDir": "../my-app",
    "baseUrl": "http://127.0.0.1:3000",
    "startCommand": "npm run dev",
    "workingDirectory": "../my-app",
    "environment": "test",
    "env": { "APP_ENV": "test" }
  },
  "artifacts": {
    "directory": "artifacts",
    "retainRuns": 20
  },
  "report": {
    "projectDirectory": "report"
  },
  "source": {
    "include": ["src"],
    "exclude": ["node_modules", ".git", "dist", "coverage"],
    "maxFiles": 20000,
    "maxFileSizeBytes": 2097152,
    "followSymlinks": false
  },
  "runtime": {
    "enabled": true,
    "headless": true,
    "navigationTimeoutMs": 30000,
    "actionTimeoutMs": 10000,
    "maxPages": 500,
    "profiles": [
      {
        "id": "chromium-desktop",
        "browser": "chromium",
        "headless": true,
        "viewport": { "width": 1440, "height": 900 }
      }
    ]
  },
  "roles": [
    {
      "id": "admin",
      "name": "admin",
      "storageStatePath": ".ai-web-test/auth/admin.json",
      "default": true
    }
  ],
  "policy": {
    "maxRisk": "read",
    "allowedHosts": ["127.0.0.1"],
    "blockedHosts": [],
    "allowExternalOrigins": false,
    "destructiveActionAllowlist": [],
    "requireTestDataNamespace": true,
    "testDataNamespace": "ai-test",
    "confirmationRequired": true
  },
  "ai": {
    "enabled": false,
    "provider": "openai-responses",
    "model": "<configured-model>",
    "apiKeyEnv": "OPENAI_API_KEY",
    "sendSource": false,
    "sendScreenshots": false,
    "maxContextChars": 50000
  },
  "presets": {
    "ci-smoke": {
      "scope": { "mode": "smoke", "includeDependencies": true },
      "level": "smoke",
      "maxRisk": "read"
    }
  }
}
```

The enforceable safety fields are `maxRisk`, `requireTestDataNamespace`,
`destructiveActionAllowlist`, and the action/host allowlists. Unknown fields are
ignored by the current validator, so generated configs should prefer the
canonical fields shown above.

## Roles and authentication

The currently supported option is to create Playwright storage state in a
dedicated test environment and reference its path. `usernameEnv`,
`passwordEnv`, and `setupScenarioId` are reserved configuration fields; the
alpha runner does not yet generate login state from them automatically. If you
record these fields for a future adapter, only environment-variable names are
valid, for example:

```json
{
  "name": "merchant",
  "usernameEnv": "TEST_MERCHANT_USER",
  "passwordEnv": "TEST_MERCHANT_PASSWORD"
}
```

The values themselves are never valid configuration literals and are redacted
from AI prompts and reports. Until an authentication adapter is implemented,
provide `storageStatePath` for every non-anonymous role used by a plan.

`ai.sendSource` is opt-in. When enabled, the AI plan request receives bounded,
line-oriented excerpts from files already referenced by the inventory; the
provider still applies secret redaction and the `maxContextChars` limit. Keep it
disabled for repositories containing proprietary or sensitive source unless the
provider and retention policy have been reviewed.

## Target startup

When `startCommand` is present, pass `--start` to `discover` or `run` to opt in to
starting it. The command is then probed, waited on, logged, and terminated after
the operation. Without `--start`, the tool never launches a configured command;
use this mode when the host process is managed externally. The command is
treated as trusted operator configuration and should point only to an isolated
test environment.
