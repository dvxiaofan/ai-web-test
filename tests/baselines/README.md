# Baselines

Committed golden artifacts produced by `npm run baseline` against the
`sample-app` fixture. They let future runs diff Inventory, Plan, and Run Result
for unintended regressions.

Regenerate with:

```bash
npx playwright install chromium   # one-time, needs the browser binary
export CODEBUDDY_API_KEY=...      # browser exploration uses AI
npm run baseline
```

Files:

- `sample-app.inventory.json` — merged runtime inventory
- `sample-app.plan.json` — approved smoke plan
- `sample-app.run-result.json` — execution result
