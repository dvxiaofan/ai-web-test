import { readFile, readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import type { ProjectConfig } from "../core/config.js";
import { isInsideDirectory } from "../core/artifacts.js";
import { pathExists } from "../core/json.js";
import { resolveWorkspace, type Workspace } from "../core/workspace.js";
import { findSecretMatches } from "../ai/redaction.js";

export type DoctorSeverity = "error" | "warning";

export interface DoctorFinding {
  /** Stable slug so a caller can branch on the kind of violation. */
  code:
    | "workspace-escape"
    | "report-tree-missing"
    | "leaked-file"
    | "plaintext-secret";
  severity: DoctorSeverity;
  message: string;
  path?: string;
  /** What to do about it — a destination path or a command to run. */
  suggestion?: string;
}

export interface DoctorReport {
  workspace: Workspace;
  findings: DoctorFinding[];
  /** False when at least one finding is an error; drives a non-zero exit code. */
  ok: boolean;
}

export interface DoctorOptions {
  /**
   * Directory audited for target-specific files that leaked out of the
   * workspace — normally the tool checkout the operator invoked `aitest` from.
   */
  toolRoot?: string;
}

/** Directories never worth walking when hunting for leaked files. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "test-output", ".claude"]);

/** Only text formats a hand-written script or note would plausibly use. */
const TEXT_EXTENSIONS = new Set([
  ".mjs", ".cjs", ".js", ".ts", ".mts", ".cts", ".json", ".md", ".txt", ".sh", ".yml", ".yaml", ".html", ".css",
]);

const MAX_SCAN_BYTES = 512 * 1024;

/**
 * Audit one target's workspace.
 *
 * Config validation already blocks a misdirected `artifacts.directory`, and
 * `run` now always emits the report tree — this covers what code cannot reach:
 * files an assistant wrote by hand in the wrong place, and credentials pasted
 * into them. Leak detection matches on *content* (the target's host or the
 * workspace path) rather than filename globs, which keeps false positives down.
 */
export async function runDoctor(config: ProjectConfig, options: DoctorOptions = {}): Promise<DoctorReport> {
  const workspace = resolveWorkspace(config);
  const findings: DoctorFinding[] = [];

  checkWorkspaceContainment(workspace, findings);
  await checkReportTree(workspace, findings);
  await checkLeakedFiles(config, workspace, options.toolRoot ?? process.cwd(), findings);
  await checkPlaintextSecrets(workspace, findings);

  return { workspace, findings, ok: !findings.some((finding) => finding.severity === "error") };
}

function checkWorkspaceContainment(workspace: Workspace, findings: DoctorFinding[]): void {
  for (const [label, dir] of [
    ["artifacts.directory", workspace.artifactsDir],
    ["report.projectDirectory", workspace.reportDir],
  ] as const) {
    if (isInsideDirectory(workspace.root, dir)) continue;
    findings.push({
      code: "workspace-escape",
      severity: "error",
      message: `${label} points outside the project workspace.`,
      path: dir,
      suggestion: `Move it under ${workspace.root}.`,
    });
  }
}

async function checkReportTree(workspace: Workspace, findings: DoctorFinding[]): Promise<void> {
  const indexPath = path.join(workspace.reportDir, "index.html");
  if (await pathExists(indexPath)) return;

  // A project that has never run legitimately has no report tree yet; one that
  // has runs but no tree means the deliverable was never produced.
  const runsDir = path.join(workspace.artifactsDir, "runs");
  const hasRuns = (await safeReaddir(runsDir)).some((entry) => entry.startsWith("run_"));
  findings.push({
    code: "report-tree-missing",
    severity: hasRuns ? "error" : "warning",
    message: hasRuns
      ? "Runs exist but the by-module report tree was never built."
      : "No report tree yet — this target has not been run.",
    path: indexPath,
    suggestion: hasRuns ? "Run `aitest report --by-module`." : "Run `aitest run` once a plan is approved.",
  });
}

async function checkLeakedFiles(
  config: ProjectConfig,
  workspace: Workspace,
  toolRoot: string,
  findings: DoctorFinding[],
): Promise<void> {
  const root = path.resolve(toolRoot);
  // Scanning from inside the workspace would flag the workspace's own files.
  if (isInsideDirectory(workspace.root, root)) return;

  const needles = leakNeedles(config, workspace);
  if (needles.length === 0) return;

  for (const filePath of await collectScanTargets(root)) {
    if (isInsideDirectory(workspace.root, filePath)) continue;
    const content = await readTextFile(filePath);
    if (content === undefined) continue;
    const hit = needles.find((needle) => content.includes(needle));
    if (hit === undefined) continue;
    findings.push({
      code: "leaked-file",
      severity: "error",
      message: `Target-specific file outside the workspace (references ${hit}).`,
      path: filePath,
      suggestion: `Move it into ${isDocLike(filePath) ? workspace.docsDir : workspace.scriptsDir}.`,
    });
  }
}

async function checkPlaintextSecrets(workspace: Workspace, findings: DoctorFinding[]): Promise<void> {
  for (const dir of [workspace.scriptsDir, workspace.docsDir]) {
    for (const filePath of await collectScanTargets(dir)) {
      const content = await readTextFile(filePath);
      if (content === undefined) continue;
      const secrets = findSecretMatches(content);
      if (secrets.length === 0) continue;
      findings.push({
        code: "plaintext-secret",
        severity: "error",
        message: `Plaintext credential in a workspace file (${secrets.length} match${secrets.length === 1 ? "" : "es"}, first: ${describeSecret(secrets[0])}).`,
        path: filePath,
        suggestion: "Reference the value by environment-variable name instead of inlining it.",
      });
    }
  }
}

/**
 * Name the credential without reprinting it — a doctor report that echoed the
 * secret would leak it into logs and terminal scrollback all over again.
 */
function describeSecret(match: string | undefined): string {
  if (match === undefined) return "unknown";
  const separator = match.search(/[:=]/);
  const label = separator > 0 ? match.slice(0, separator).trim() : match.split(/\s+/)[0] ?? match;
  return `${label} [value redacted]`;
}

/**
 * Strings that mark a file as belonging to this target: the host under test and
 * the workspace path. Both are specific enough that a match is near-certainly a
 * target artifact rather than tool source.
 */
function leakNeedles(config: ProjectConfig, workspace: Workspace): string[] {
  const needles = [workspace.root];
  const baseUrl = config.target.baseUrl;
  if (baseUrl) {
    try {
      needles.push(new URL(baseUrl).host);
    } catch {
      // A malformed baseUrl is already reported by config validation.
    }
  }
  return needles;
}

function isDocLike(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".txt";
}

/** Files directly in `dir` plus one level of subdirectories — where strays land. */
async function collectScanTargets(dir: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await safeReaddir(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const info = await safeStat(full);
    if (info === undefined) continue;
    if (info.isDirectory()) {
      for (const nested of await safeReaddir(full)) {
        if (nested.startsWith(".")) continue;
        const nestedPath = path.join(full, nested);
        const nestedInfo = await safeStat(nestedPath);
        if (nestedInfo?.isFile() && isScannable(nestedPath, nestedInfo.size)) results.push(nestedPath);
      }
      continue;
    }
    if (info.isFile() && isScannable(full, info.size)) results.push(full);
  }
  return results;
}

function isScannable(filePath: string, size: number): boolean {
  return size <= MAX_SCAN_BYTES && TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function safeStat(target: string): Promise<Stats | undefined> {
  try {
    return await stat(target);
  } catch {
    return undefined;
  }
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}
