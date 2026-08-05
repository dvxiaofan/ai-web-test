import { buildErrorEnvelope, buildSuccessEnvelope, deriveNextActions, normalizeAgentError, type AgentState } from "../agent/index.js";
import type { Workspace } from "../core/workspace.js";

export interface CliOutputOptions {
  json: boolean;
  quiet: boolean;
  projectId?: string;
  operationId?: string;
}

export interface CliOutputContext {
  projectId?: string;
  planId?: string;
}

/**
 * CLI output sink.
 *
 * In JSON mode, stdout carries only the Agent Response envelope so an AI can
 * parse it deterministically; all human-facing logs go to stderr. In human
 * mode, progress goes to stdout and the final result object is logged to
 * stderr (keeping stdout a clean, copy-pasteable narrative).
 */
export class CliOutput {
  #json: boolean;
  #quiet: boolean;
  #warnings: string[] = [];
  #projectId: string | undefined;
  #planId: string | undefined;
  #operationId: string | undefined;
  #workspace: Workspace | undefined;

  constructor(options: CliOutputOptions) {
    this.#json = options.json;
    this.#quiet = options.quiet;
    this.#projectId = options.projectId;
    this.#operationId = options.operationId;
  }

  /** Enrich the envelope context (project/plan identity) discovered mid-command. */
  setContext(context: CliOutputContext): void {
    if (context.projectId) this.#projectId = context.projectId;
    if (context.planId) this.#planId = context.planId;
  }

  /**
   * Record the target's workspace so every JSON result carries the absolute
   * paths an assistant is allowed to write to. Set once, right after the config
   * loads, instead of being threaded through each command.
   */
  setWorkspace(workspace: Workspace): void {
    this.#workspace = workspace;
  }

  info(message: string): void {
    if (this.#quiet) return;
    // In JSON mode logs go to stderr so stdout stays a pure JSON envelope.
    const target = this.#json ? process.stderr : process.stdout;
    target.write(`${message}\n`);
  }

  warn(message: string): void {
    if (this.#json) {
      this.#warnings.push(message);
      return;
    }
    process.stderr.write(`warn: ${message}\n`);
  }

  result(value: unknown, state?: AgentState): void {
    if (this.#json) {
      const envelope = buildSuccessEnvelope(value as Record<string, unknown>, this.#warnings);
      this.#warnings = [];
      if (state) envelope.state = state;
      const ctx: { projectId?: string; planId?: string } = {};
      if (this.#projectId) ctx.projectId = this.#projectId;
      if (this.#planId) ctx.planId = this.#planId;
      envelope.nextActions = deriveNextActions(state, ctx);
      if (this.#projectId) envelope.projectId = this.#projectId;
      if (this.#planId) envelope.planId = this.#planId;
      if (this.#operationId) envelope.operationId = this.#operationId;
      if (this.#workspace) envelope.workspace = workspacePaths(this.#workspace);
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    if (typeof value === "string") {
      process.stdout.write(`${value}\n`);
    }
  }

  error(error: unknown): void {
    if (this.#json) {
      process.stderr.write(`${JSON.stringify(buildErrorEnvelope(normalizeAgentError(error)))}\n`);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
  }
}

/** Flatten a Workspace into the string map the response envelope carries. */
function workspacePaths(workspace: Workspace): Record<string, string> {
  return {
    root: workspace.root,
    ...(workspace.configPath !== undefined ? { configPath: workspace.configPath } : {}),
    artifactsDir: workspace.artifactsDir,
    reportDir: workspace.reportDir,
    docsDir: workspace.docsDir,
    scriptsDir: workspace.scriptsDir,
  };
}
