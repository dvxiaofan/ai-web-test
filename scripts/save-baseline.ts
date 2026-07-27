/**
 * Batch 0.2 — baseline generator.
 *
 * Runs the sample-app fixture end-to-end (discover -> explore -> inventory ->
 * plan -> approve -> execute) and writes the canonical baseline artifacts so
 * future runs can diff against them as golden references.
 *
 * Requirements:
 *   - Playwright Chromium installed: `npx playwright install chromium`
 *   - CODEBUDDY_API_KEY in the environment (browser exploration uses AI)
 *
 * Run with: `npm run baseline`
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { exploreBrowser } from "../src/browser/index.js";
import { createDefaultPolicy, stableStringify } from "../src/core/index.js";
import { discoverSource } from "../src/discovery/index.js";
import { mergeBrowserExploration } from "../src/inventory/index.js";
import { approvePlan, proposePlan } from "../src/planning/index.js";
import { executePlan } from "../src/execution/index.js";
import { generateRouteSmokeScenarios } from "../src/scenarios/index.js";

const fixtureRoot = path.resolve("fixtures/sample-app");
const outDir = path.resolve("tests/baselines");
const port = 4197;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForUrl(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // target is still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Fixture did not start at ${url}`);
}

async function main(): Promise<void> {
  if (!process.env.CODEBUDDY_API_KEY) {
    throw new Error("CODEBUDDY_API_KEY is required to explore the fixture with AI");
  }

  await mkdir(outDir, { recursive: true });
  const child: ChildProcess = spawn("node", ["server.mjs"], {
    cwd: fixtureRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });

  try {
    await waitForUrl(baseUrl);

    const draft = await discoverSource({ rootDir: fixtureRoot, baseUrl, projectName: "sample-shop" });
    const exploration = await exploreBrowser({
      baseUrl,
      browserName: "chromium",
      headless: true,
      maxPages: 10,
      captureScreenshots: false,
      playwrightLoader: async () => import("playwright"),
    });
    const inventory = mergeBrowserExploration(draft.inventory, exploration);
    const scenarios = generateRouteSmokeScenarios(inventory, { screenshot: false });
    const policy = createDefaultPolicy(baseUrl);
    const proposed = proposePlan({
      inventory,
      scenarios,
      scope: { mode: "smoke", includeDependencies: true },
      target: { baseUrl, projectRoot: fixtureRoot, environment: "test" },
      policy,
      roles: [],
      browserProfiles: [{ id: "chromium", browser: "chromium", headless: true, viewport: { width: 1280, height: 800 } }],
      level: "smoke",
    });
    const approved = approvePlan(proposed.plan, { approvedBy: "baseline" }, { inventory, scenarios });
    const result = await executePlan(approved, {
      inventory,
      scenarios,
      outputDir: path.resolve(".tmp-e2e-runs"),
      captureTrace: false,
      captureScreenshotsOnFailure: false,
      playwrightLoader: async () => import("playwright"),
    });

    await writeFile(path.join(outDir, "sample-app.inventory.json"), stableStringify(inventory, null, 2) + "\n");
    await writeFile(path.join(outDir, "sample-app.plan.json"), stableStringify(approved, null, 2) + "\n");
    await writeFile(path.join(outDir, "sample-app.run-result.json"), stableStringify(result, null, 2) + "\n");

    console.log(`Baseline artifacts written to ${outDir}`);
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
