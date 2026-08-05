import { mkdir } from "node:fs/promises";
import path from "node:path";

import { ensureSelfIgnoringGitignore, isInsideDirectory } from "./artifacts.js";
import type { ProjectConfig } from "./config.js";

/**
 * The one directory layout every target produces.
 *
 * `root` is the directory holding that target's `config.json` — for
 * `aitest init` that is `test-output/<project>/`. Config validation rejects any
 * `artifacts.directory` / `report.projectDirectory` that escapes it, so this
 * shape is a contract rather than a convention: nothing about a target is ever
 * written to the tool repository or into the target's own source tree.
 *
 * ```
 * test-output/<project>/
 *   config.json
 *   artifacts/   inventory, scenarios, plans, runs
 *   report/      index.html + one subdirectory per tested module
 *   docs/        hand-written analysis (the only legal home for it)
 *   scripts/     target-specific one-off scripts (likewise)
 * ```
 */
export interface Workspace {
  root: string;
  configPath?: string | undefined;
  artifactsDir: string;
  reportDir: string;
  docsDir: string;
  scriptsDir: string;
}

/**
 * Resolve the report tree root: `report/` beside the artifact workspace unless
 * `config.report.projectDirectory` renames it. Lives here rather than in
 * `reporting/` so `core/` owns the layout and `reporting/` depends on core, not
 * the other way round.
 */
export function resolveReportDir(config: ProjectConfig): string {
  const override = config.report?.projectDirectory;
  if (override && override.trim().length > 0) {
    return path.resolve(config.configDir, override);
  }
  return path.resolve(path.dirname(config.artifacts.directory), "report");
}

export function resolveWorkspace(config: ProjectConfig): Workspace {
  const root = path.resolve(config.configDir);
  return {
    root,
    configPath: config.configPath,
    artifactsDir: path.resolve(config.artifacts.directory),
    reportDir: resolveReportDir(config),
    docsDir: path.join(root, "docs"),
    scriptsDir: path.join(root, "scripts"),
  };
}

/**
 * Create the hand-authored corners of the workspace (`docs/`, `scripts/`) so an
 * assistant has a directory to put analysis and one-off scripts in instead of
 * inventing one next to the tool's own source.
 */
export async function ensureWorkspace(workspace: Workspace): Promise<void> {
  await Promise.all([
    mkdir(workspace.docsDir, { recursive: true }),
    mkdir(workspace.scriptsDir, { recursive: true }),
  ]);
  await Promise.all([
    ensureSelfIgnoringGitignore(workspace.docsDir),
    ensureSelfIgnoringGitignore(workspace.scriptsDir),
  ]);
}

/** True when `candidate` is somewhere the target's outputs are allowed to live. */
export function isInsideWorkspace(workspace: Workspace, candidate: string): boolean {
  return isInsideDirectory(workspace.root, candidate);
}
