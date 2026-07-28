import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ArtifactStore } from '../core/artifacts.js';

export interface RetentionPolicy {
  /** Keep at most this many run workspaces (newest first). */
  maxRuns?: number | undefined;
  /** Delete run workspaces older than this many days. */
  maxAgeDays?: number | undefined;
  /**
   * Run ids that must never be deleted regardless of age/count —
   * e.g. approved baselines or runs referenced by open findings.
   */
  pinnedRunIds?: string[] | undefined;
}

export interface RetentionPlanEntry {
  runId: string;
  reason: 'max-runs' | 'max-age';
  startedAt: string;
}

export interface RetentionReport {
  /** Runs that were (or would be) removed. */
  removed: RetentionPlanEntry[];
  /** Runs kept, newest first. */
  kept: string[];
  dryRun: boolean;
}

interface RunEntry {
  runId: string;
  mtimeMs: number;
  startedAt: string;
}

/**
 * Apply the artifact retention policy to persisted run workspaces (Phase 6).
 *
 * Selection is deterministic: runs are ordered newest-first by result
 * timestamp (falling back to directory mtime), pinned runs are always kept,
 * then `maxAgeDays` and `maxRuns` are enforced in that order. With
 * `dryRun: true` nothing is deleted — the report shows what would happen.
 */
export async function applyRetentionPolicy(
  store: ArtifactStore,
  policy: RetentionPolicy,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<RetentionReport> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();

  const entries = await listRunEntries(store);
  entries.sort((left, right) => right.startedAt.localeCompare(left.startedAt));

  const pinned = new Set(policy.pinnedRunIds ?? []);
  const removed: RetentionPlanEntry[] = [];
  const kept: string[] = [];

  const cutoffMs = policy.maxAgeDays !== undefined ? now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000 : undefined;

  let retainedCount = 0;
  for (const entry of entries) {
    if (pinned.has(entry.runId)) {
      kept.push(entry.runId);
      retainedCount += 1;
      continue;
    }
    const tooOld = cutoffMs !== undefined && Date.parse(entry.startedAt) < cutoffMs;
    const overCount = policy.maxRuns !== undefined && retainedCount >= policy.maxRuns;
    if (tooOld || overCount) {
      removed.push({ runId: entry.runId, reason: tooOld ? 'max-age' : 'max-runs', startedAt: entry.startedAt });
      continue;
    }
    kept.push(entry.runId);
    retainedCount += 1;
  }

  if (!dryRun) {
    for (const entry of removed) {
      await rm(path.join(store.layout.runs, entry.runId), { recursive: true, force: true });
    }
  }

  return { removed, kept, dryRun };
}

async function listRunEntries(store: ArtifactStore): Promise<RunEntry[]> {
  let names: string[] = [];
  try {
    names = await readdir(store.layout.runs);
  } catch {
    return [];
  }
  const entries: RunEntry[] = [];
  for (const runId of names) {
    const runDir = path.join(store.layout.runs, runId);
    let mtimeMs: number;
    try {
      const info = await stat(runDir);
      if (!info.isDirectory()) continue;
      mtimeMs = info.mtimeMs;
    } catch {
      continue;
    }
    let startedAt = new Date(mtimeMs).toISOString();
    try {
      const result = await store.readRunResult(runId);
      startedAt = result.startedAt;
    } catch {
      // Interrupted runs keep the directory mtime as their timestamp.
    }
    entries.push({ runId, mtimeMs, startedAt });
  }
  return entries;
}
