import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readJsonFile, pathExists, writeJsonFile, type WriteJsonOptions } from "./json.js";
import type { Inventory, ProjectOverview, RunPlan, RunResult } from "./types.js";

export interface ArtifactLayout {
  root: string;
  inventory: string;
  overview: string;
  plans: string;
  generatedTests: string;
  runs: string;
  cache: string;
}

export interface RunArtifactWorkspace {
  root: string;
  result: string;
  report: string;
  markdown: string;
  screenshots: string;
  traces: string;
  videos: string;
  logs: string;
}

export type PlanArtifactKind = "proposed" | "approved";

export function createArtifactLayout(directory: string): ArtifactLayout {
  const root = path.resolve(directory);
  return {
    root,
    inventory: path.join(root, "inventory.json"),
    overview: path.join(root, "overview.json"),
    plans: path.join(root, "plans"),
    generatedTests: path.join(root, "generated-tests"),
    runs: path.join(root, "runs"),
    cache: path.join(root, "cache"),
  };
}

/**
 * Safe access to the per-target artifact workspace.
 *
 * All relative paths are checked to ensure callers cannot escape the configured
 * root. JSON writes are canonical and atomic through writeJsonFile.
 */
export class ArtifactStore {
  readonly layout: ArtifactLayout;

  constructor(directory: string) {
    this.layout = createArtifactLayout(directory);
  }

  get rootDir(): string {
    return this.layout.root;
  }

  async initialize(): Promise<ArtifactLayout> {
    await Promise.all([
      mkdir(this.layout.root, { recursive: true }),
      mkdir(this.layout.plans, { recursive: true }),
      mkdir(this.layout.generatedTests, { recursive: true }),
      mkdir(this.layout.runs, { recursive: true }),
      mkdir(this.layout.cache, { recursive: true }),
    ]);
    return this.layout;
  }

  resolve(...segments: string[]): string {
    const candidate = path.resolve(this.layout.root, ...segments);
    assertInside(this.layout.root, candidate);
    return candidate;
  }

  relative(artifactPath: string): string {
    const absolute = path.resolve(artifactPath);
    assertInside(this.layout.root, absolute);
    return path.relative(this.layout.root, absolute).split(path.sep).join("/");
  }

  planPath(planId: string, kind: PlanArtifactKind = "proposed"): string {
    assertArtifactId(planId, "plan id");
    return path.join(this.layout.plans, `${kind}-${planId}.json`);
  }

  runWorkspace(runId: string): RunArtifactWorkspace {
    assertArtifactId(runId, "run id");
    const root = path.join(this.layout.runs, runId);
    return {
      root,
      result: path.join(root, "result.json"),
      report: path.join(root, "report.html"),
      markdown: path.join(root, "report.md"),
      screenshots: path.join(root, "screenshots"),
      traces: path.join(root, "traces"),
      videos: path.join(root, "videos"),
      logs: path.join(root, "logs"),
    };
  }

  async createRunWorkspace(runId: string): Promise<RunArtifactWorkspace> {
    const workspace = this.runWorkspace(runId);
    await Promise.all([
      mkdir(workspace.root, { recursive: true }),
      mkdir(workspace.screenshots, { recursive: true }),
      mkdir(workspace.traces, { recursive: true }),
      mkdir(workspace.videos, { recursive: true }),
      mkdir(workspace.logs, { recursive: true }),
    ]);
    return workspace;
  }

  async writeInventory(inventory: Inventory): Promise<string> {
    await writeJsonFile(this.layout.inventory, inventory);
    return this.layout.inventory;
  }

  async readInventory(): Promise<Inventory> {
    return readJsonFile<Inventory>(this.layout.inventory);
  }

  async writeOverview(overview: ProjectOverview): Promise<string> {
    await writeJsonFile(this.layout.overview, overview);
    return this.layout.overview;
  }

  async readOverview(): Promise<ProjectOverview> {
    return readJsonFile<ProjectOverview>(this.layout.overview);
  }

  /** Overview is optional; absent file yields undefined instead of throwing. */
  async readOverviewIfExists(): Promise<ProjectOverview | undefined> {
    if (!(await pathExists(this.layout.overview))) return undefined;
    return this.readOverview();
  }

  async writePlan(plan: RunPlan, kind?: PlanArtifactKind): Promise<string> {
    const artifactKind = kind ?? (plan.status === "proposed" ? "proposed" : "approved");
    const targetPath = this.planPath(plan.id, artifactKind);
    await writeJsonFile(targetPath, plan);
    return targetPath;
  }

  async readPlan(planId: string, kind: PlanArtifactKind = "proposed"): Promise<RunPlan> {
    return readJsonFile<RunPlan>(this.planPath(planId, kind));
  }

  async writeRunResult(result: RunResult): Promise<string> {
    const workspace = await this.createRunWorkspace(result.id);
    await writeJsonFile(workspace.result, result);
    return workspace.result;
  }

  async readRunResult(runId: string): Promise<RunResult> {
    return readJsonFile<RunResult>(this.runWorkspace(runId).result);
  }

  async writeJson(relativePath: string, value: unknown, options?: WriteJsonOptions): Promise<string> {
    const targetPath = this.resolve(relativePath);
    await writeJsonFile(targetPath, value, options);
    return targetPath;
  }

  async readJson<T>(relativePath: string): Promise<T> {
    return readJsonFile<T>(this.resolve(relativePath));
  }

  async writeText(relativePath: string, content: string): Promise<string> {
    const targetPath = this.resolve(relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
    return targetPath;
  }

  async readText(relativePath: string): Promise<string> {
    return readFile(this.resolve(relativePath), "utf8");
  }

  async exists(relativePath: string): Promise<boolean> {
    return pathExists(this.resolve(relativePath));
  }
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Artifact path escapes the configured workspace: ${candidate}`);
  }
}

function assertArtifactId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
}
