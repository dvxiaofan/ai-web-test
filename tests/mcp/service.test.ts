import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../src/core/index.js';
import { McpService } from '../../src/mcp/index.js';
import { buildTestInventory } from '../fixtures/inventory.js';

/** Recursively drop `undefined` values so stableStringify (used by plan digests) won't throw. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) out[key] = stripUndefined(val);
    }
    return out as unknown as T;
  }
  return value;
}

describe('McpService (no browser required)', () => {
  let configPath: string;
  let tmpDir: string;
  let service: McpService;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-svc-'));
    const raw = JSON.parse(await readFile(path.resolve('examples/sample.config.json'), 'utf8'));
    raw.artifacts.directory = path.join(tmpDir, '.artifacts');
    configPath = path.join(tmpDir, 'ai-web-test.config.json');
    await writeFile(configPath, JSON.stringify(raw, null, 2));

    const store = new ArtifactStore(raw.artifacts.directory);
    await store.initialize();
    // proposePlan computes a content digest via stableStringify, which rejects
    // any `undefined` value, so strip them before use.
    const inventory = stripUndefined(buildTestInventory());
    inventory.schemaVersion = 1;
    inventory.generatedAt = new Date().toISOString();
    inventory.credentials = inventory.credentials ?? [];
    inventory.project.id = inventory.project.id ?? 'test-app';
    inventory.project.rootDir = inventory.project.rootDir ?? '/tmp/test-app';
    for (const node of inventory.nodes) {
      if (node.kind === 'route') {
        node.confidence = node.confidence ?? 0.8;
        if (!node.roleIds) node.roleIds = [];
      }
    }
    await store.writeInventory(inventory);

    service = new McpService({ configPath });
  });

  afterAll(async () => {
    // Best-effort cleanup; ignore failures in CI temp dirs.
    await import('node:fs/promises').then((fs) => fs.rm(tmpDir, { recursive: true, force: true }));
  });

  it('status reports ready once an inventory exists', async () => {
    const status = await service.status();
    expect(status.ready).toBe(true);
    expect(status.configPath).toBe(configPath);
    expect(status.summary).toBeDefined();
    expect(status.scenarioCount).toBeGreaterThanOrEqual(0);
  });

  it('inventoryQuery(summary) returns a non-empty coverage summary', async () => {
    const result = (await service.inventoryQuery({ action: 'summary' })) as Record<string, unknown>;
    expect(typeof result).toBe('object');
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it('business builds coverage and gaps from the inventory', async () => {
    const result = await service.business();
    expect(result.coverage).toBeDefined();
    expect(result.coverage.project).toBeDefined();
    expect(Array.isArray(result.gaps)).toBe(true);
  });

  it('plan proposes a plan without launching a browser', async () => {
    const result = await service.plan({ scope: 'smoke' });
    expect(result.plan.id).toBeTruthy();
    expect(result.validation).toBeDefined();
    expect(result.plan.scenarioIds.length).toBeGreaterThanOrEqual(0);
  });

  it('scenariosGenerate writes a scenario catalog and reports a count', async () => {
    const result = await service.scenariosGenerate();
    expect(result.count).toBeGreaterThan(0);
    expect(result.path).toContain('scenarios.json');
  });
});
