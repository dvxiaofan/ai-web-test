import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface VisualSnapshotOptions {
  baselineDir?: string;
  baselineKey?: string;
  updateBaseline?: boolean;
}

export interface VisualSnapshotResult {
  baselinePath?: string;
  baselineExists: boolean;
  changed: boolean;
  currentDigest: string;
  baselineDigest?: string;
}

export async function compareOrCreateVisualSnapshot(
  screenshotPath: string,
  options: VisualSnapshotOptions,
): Promise<VisualSnapshotResult> {
  const current = await readFile(screenshotPath);
  const currentDigest = digest(current);
  if (!options.baselineDir || !options.baselineKey) {
    return { baselineExists: false, changed: false, currentDigest };
  }
  const baselinePath = path.resolve(options.baselineDir, `${sanitize(options.baselineKey)}.png`);
  await mkdir(path.dirname(baselinePath), { recursive: true });
  let baseline: Buffer | undefined;
  try {
    baseline = await readFile(baselinePath);
  } catch {
    baseline = undefined;
  }
  if (baseline === undefined && !options.updateBaseline) {
    return { baselineExists: false, changed: false, currentDigest };
  }
  if (baseline === undefined || options.updateBaseline) {
    await copyFile(screenshotPath, baselinePath);
    const previousDigest = baseline === undefined ? undefined : digest(baseline);
    return {
      baselinePath,
      baselineExists: Boolean(baseline),
      changed: previousDigest !== undefined && previousDigest !== currentDigest,
      currentDigest,
      ...(previousDigest ? { baselineDigest: previousDigest } : {}),
    };
  }
  const baselineDigest = digest(baseline);
  return {
    baselinePath,
    baselineExists: true,
    changed: baselineDigest !== currentDigest,
    currentDigest,
    baselineDigest,
  };
}

function digest(value: Buffer): string {
  return createHash('sha256').update(new Uint8Array(value)).digest('hex');
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/\//g, '__').replace(/^-+|-+$/g, '').slice(0, 180) || 'snapshot';
}
