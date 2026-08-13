import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main, resolveConfigPath } from '../../src/cli.js';
import { parseCliArgs } from '../../src/cli/index.js';
import { loadConfig } from '../../src/core/index.js';

const originalCwd = process.cwd();
let workDir: string;
let spies: Array<{ mockRestore(): void }> = [];

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'ai-web-test-init-'));
  process.chdir(workDir);
  // Keep CLI envelopes out of the test runner output.
  spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true),
  ];
});

afterEach(async () => {
  process.chdir(originalCwd);
  for (const spy of spies) spy.mockRestore();
  process.exitCode = 0;
  await rm(workDir, { force: true, recursive: true });
});

describe('init: per-target workspace layout', () => {
  it('creates test-output/<project>/config.json for a source-tree target', async () => {
    const cwd = process.cwd();
    await mkdir(path.join(cwd, 'my-app'));

    await main(['init', 'my-app', '--json']);
    expect(process.exitCode ?? 0).toBe(0);

    const configPath = path.join(cwd, 'test-output', 'my-app', 'config.json');
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, any>;
    expect(raw.target.rootDir).toBe(path.join(cwd, 'my-app')); // absolute, machine-local
    expect(raw.target.discovery).toBeUndefined();
    expect(raw.artifacts.directory).toBe('artifacts');
    expect(raw.report.projectDirectory).toBe('report');

    // The shared workspace root ignores everything it contains.
    await expect(readFile(path.join(cwd, 'test-output', '.gitignore'), 'utf8')).resolves.toBe('*\n');

    // The generated config loads, and all outputs resolve inside the workspace.
    const config = await loadConfig(configPath);
    expect(config.artifacts.directory).toBe(path.join(cwd, 'test-output', 'my-app', 'artifacts'));
    expect(config.report.projectDirectory).toBe('report');
  });

  it('creates a runtime-first workspace from --url only (no source access)', async () => {
    const cwd = process.cwd();

    await main(['init', '--url', 'http://10.0.0.5:9090', '--name', 'itbar', '--json']);
    expect(process.exitCode ?? 0).toBe(0);

    const configPath = path.join(cwd, 'test-output', 'itbar', 'config.json');
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, any>;
    expect(raw.target.discovery).toBe('runtime-first');
    expect(raw.target.rootDir).toBeUndefined();
    expect(raw.target.startCommand).toBeUndefined();
    expect(raw.target.baseUrl).toBe('http://10.0.0.5:9090');
    expect(raw.policy.allowedHosts).toEqual(['10.0.0.5:9090']);

    const config = await loadConfig(configPath);
    expect(config.target.discovery).toBe('runtime-first');
    expect(config.artifacts.directory).toBe(path.join(cwd, 'test-output', 'itbar', 'artifacts'));
  });

  it('refuses runtime-first init without a base URL', async () => {
    await main(['init', '--runtime-first', '--json']);
    expect(process.exitCode).toBe(1);
  });
});

describe('--project shorthand', () => {
  it('maps --project to test-output/<slug>/config.json and lets --config win', () => {
    const cwd = process.cwd();
    expect(resolveConfigPath(parseCliArgs(['status', '--project', 'ITBar']))).toBe(
      path.join(cwd, 'test-output', 'itbar', 'config.json'),
    );
    expect(resolveConfigPath(parseCliArgs(['status', '--config', 'x/y.json', '--project', 'itbar']))).toBe(
      path.join(cwd, 'x', 'y.json'),
    );
    expect(resolveConfigPath(parseCliArgs(['status']))).toBe(path.join(cwd, 'ai-web-test.config.json'));
  });
});
