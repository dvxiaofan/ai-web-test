import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  storageStateIsValid,
  loadStorageState,
  saveStorageState,
  redactStorageState,
} from '../../src/auth/storage-state.js';
import type { StorageState } from '../../src/auth/types.js';

const valid: StorageState = {
  cookies: [{ name: 'sid', value: 'abc', domain: 'x', path: '/' }],
  origins: [{ origin: 'https://x', localStorage: [{ name: 'k', value: 'v' }] }],
};

describe('storageStateIsValid', () => {
  it('accepts a well-formed state', () => {
    expect(storageStateIsValid(valid)).toBe(true);
  });

  it('rejects non-objects and bad shapes', () => {
    expect(storageStateIsValid(null)).toBe(false);
    expect(storageStateIsValid({ cookies: [], origins: 'x' })).toBe(false);
    expect(storageStateIsValid({ cookies: [{ name: 1 }], origins: [] })).toBe(false);
    expect(
      storageStateIsValid({ cookies: [], origins: [{ origin: 'x', localStorage: [{ name: 1, value: 'v' }] }] }),
    ).toBe(false);
  });
});

describe('load/save storage state', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aitest-ss-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');

  it('round-trips a valid state', async () => {
    await saveStorageState(file, valid);
    const loaded = await loadStorageState(file);
    expect(loaded).toEqual(valid);
  });

  it('rejects invalid JSON', async () => {
    const bad = path.join(dir, 'bad.json');
    await writeFile(bad, '{not json', 'utf8');
    await expect(loadStorageState(bad)).rejects.toThrow();
  });

  it('rejects an invalid shape on load', async () => {
    const bad = path.join(dir, 'badshape.json');
    await writeFile(bad, JSON.stringify({ cookies: [], origins: 'x' }), 'utf8');
    await expect(loadStorageState(bad)).rejects.toThrow();
  });

  it('refuses to save an invalid state', async () => {
    await expect(
      saveStorageState(path.join(dir, 'x.json'), { cookies: [], origins: 'x' } as unknown as StorageState),
    ).rejects.toThrow();
  });
});

describe('redactStorageState', () => {
  it('replaces credential values but keeps structure', () => {
    const redacted = redactStorageState(valid);
    expect(redacted.cookies[0]?.value).toBe('<redacted>');
    expect(redacted.origins[0]?.localStorage[0]?.value).toBe('<redacted>');
    expect(redacted.cookies[0]?.name).toBe('sid');
  });
});
