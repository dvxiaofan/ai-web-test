import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageState, StorageStateCookie, StorageStateOrigin } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an untrusted storage-state object (Playwright-compatible shape).
 * Never throws; returns a type predicate so callers can gate on validity.
 */
export function storageStateIsValid(state: unknown): state is StorageState {
  if (!isRecord(state)) return false;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) return false;
  const cookiesValid = state.cookies.every(
    (cookie) => isRecord(cookie) && typeof cookie.name === 'string' && typeof cookie.value === 'string',
  );
  const originsValid = state.origins.every(
    (origin) =>
      isRecord(origin) &&
      typeof origin.origin === 'string' &&
      Array.isArray(origin.localStorage) &&
      origin.localStorage.every(
        (item) => isRecord(item) && typeof item.name === 'string' && typeof item.value === 'string',
      ),
  );
  return cookiesValid && originsValid;
}

export async function loadStorageState(filePath: string): Promise<StorageState> {
  const raw = await readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Storage state is not valid JSON: ${filePath}`);
  }
  if (!storageStateIsValid(parsed)) {
    throw new Error(`Storage state file has an unexpected shape: ${filePath}`);
  }
  return parsed;
}

export async function saveStorageState(filePath: string, state: StorageState): Promise<void> {
  if (!storageStateIsValid(state)) {
    throw new Error('Refusing to save an invalid storage state.');
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Replace credential values with a stable placeholder so storage state can be
 * printed to logs, summaries, or the AI context without leaking secrets.
 */
export function redactStorageState(state: StorageState): StorageState {
  const cookies: StorageStateCookie[] = state.cookies.map((cookie) => ({ ...cookie, value: '<redacted>' }));
  const origins: StorageStateOrigin[] = state.origins.map((origin) => ({
    origin: origin.origin,
    localStorage: origin.localStorage.map((item) => ({ name: item.name, value: '<redacted>' })),
  }));
  return { cookies, origins };
}
