# CI integration

The recommended CI contract is non-interactive and explicit:

```bash
npm ci
npx playwright install --with-deps chromium
npm run build
node dist/cli.js discover --config ai-web-test.config.json --static-only --json
node dist/cli.js plan --config ai-web-test.config.json --scope smoke --non-interactive --json
node dist/cli.js approve --config ai-web-test.config.json --plan "$PLAN_ID" --yes --by ci
node dist/cli.js run --config ai-web-test.config.json --plan "$PLAN_ID" --json
```

In practice, CI should capture the plan ID from the JSON output or use a
checked-in approved-plan workflow that verifies the inventory digest before
execution. A safer common split is:

- pull requests: `smoke` or `affected`, read-only;
- main branch: critical modules and roles;
- nightly: full regression and visual baselines;
- release: full regression with a separately approved test-data namespace.

The process that starts the target web server should own its database reset and
teardown. Do not point the default policy at production or a shared staging
database.

## Container image

The included `Dockerfile` builds the CLI and installs Chromium. Mount the target
source and artifact directory explicitly, and use a reachable base URL:

```bash
docker build -t ai-web-test .
docker run --rm \
  -v "$PWD/../target-app:/target:ro" \
  -v "$PWD/ai-web-test.config.json:/config/ai-web-test.config.json:ro" \
  -v "$PWD/.ai-web-test:/artifacts" \
  ai-web-test discover --config /config/ai-web-test.config.json --json
```

For reproducible organizational builds, commit a generated lockfile and replace
`npm install` in the Dockerfile with `npm ci`.
