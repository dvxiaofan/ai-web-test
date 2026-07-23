import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Inventory, SourceLocation } from '../core/index.js';
import { redactText } from './redaction.js';

export interface SourceExcerpt {
  filePath: string;
  line?: number;
  content: string;
}

export interface SourceExcerptOptions {
  maxFiles?: number;
  maxChars?: number;
  linesAround?: number;
}

/**
 * Collect small, line-oriented excerpts from files already referenced by the
 * inventory. Paths are constrained to the target root and are returned as
 * relative paths, so an AI provider does not receive arbitrary host paths.
 */
export async function collectSourceExcerpts(
  inventory: Inventory,
  rootDir: string,
  options: SourceExcerptOptions = {},
): Promise<SourceExcerpt[]> {
  const root = path.resolve(rootDir);
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? 32, 200));
  const maxChars = Math.max(1_000, options.maxChars ?? 20_000);
  const linesAround = Math.max(0, Math.min(options.linesAround ?? 6, 30));
  const locations = collectLocations(inventory)
    .map((location) => normalizeLocation(location, root))
    .filter((location): location is { absolutePath: string; relativePath: string; line?: number } => location !== undefined)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath) || (left.line ?? 0) - (right.line ?? 0));

  const seen = new Set<string>();
  const excerpts: SourceExcerpt[] = [];
  let usedChars = 0;
  for (const location of locations) {
    if (excerpts.length >= maxFiles) break;
    const key = `${location.relativePath}:${location.line ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let source: string;
    try {
      source = await readFile(location.absolutePath, 'utf8');
    } catch {
      continue;
    }
    const lines = source.split(/\r?\n/);
    const line = location.line === undefined ? undefined : Math.max(1, Math.min(location.line, lines.length));
    const start = line === undefined ? 0 : Math.max(0, line - 1 - linesAround);
    const end = line === undefined ? Math.min(lines.length, linesAround * 2 + 1) : Math.min(lines.length, line + linesAround);
    const content = redactText(lines.slice(start, end).join('\n'));
    if (content.length === 0) continue;
    const remaining = maxChars - usedChars;
    if (remaining <= 0) break;
    const bounded = content.slice(0, remaining);
    excerpts.push({
      filePath: location.relativePath,
      ...(line === undefined ? {} : { line }),
      content: bounded,
    });
    usedChars += bounded.length;
  }
  return excerpts;
}

function collectLocations(inventory: Inventory): SourceLocation[] {
  const locations: SourceLocation[] = [];
  for (const node of inventory.nodes) {
    if (node.evidence) {
      for (const evidence of node.evidence) if (evidence.source) locations.push(evidence.source);
    }
    if ('sourceFile' in node && node.sourceFile) locations.push({ filePath: node.sourceFile });
    if ('entryFile' in node && node.entryFile) locations.push({ filePath: node.entryFile });
  }
  for (const finding of inventory.findings) {
    if (finding.source) locations.push(finding.source);
    for (const evidence of finding.evidence) if (evidence.source) locations.push(evidence.source);
  }
  return locations;
}

function normalizeLocation(
  location: SourceLocation,
  root: string,
): { absolutePath: string; relativePath: string; line?: number } | undefined {
  if (!location.filePath || location.filePath.includes('\0')) return undefined;
  const absolutePath = path.resolve(root, location.filePath);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return undefined;
  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).join('/'),
    ...(location.line === undefined ? {} : { line: location.line }),
  };
}
