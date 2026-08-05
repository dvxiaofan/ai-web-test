import { ConfigValidationError } from "../core/index.js";

/**
 * Phase 1 Agent Response Protocol.
 *
 * Every AI-facing CLI command emits a single, stable envelope on stdout (JSON
 * mode) so an agent can drive the workflow without parsing human text. Errors
 * go to stderr as an envelope whose `error` carries a stable `code` and a
 * `retryable` flag.
 */

export type AgentState =
  | "initialized"
  | "discovered"
  | "plan_proposed"
  | "plan_approved"
  | "running"
  | "completed"
  | "failed";

export interface NextAction {
  action: string;
  arguments?: Record<string, unknown>;
}

export interface AgentErrorDetail {
  /** Stable, machine-readable identifier. Never localize this string. */
  code: string;
  message: string;
  retryable: boolean;
}

export interface AgentSuccessResponse {
  ok: true;
  projectId?: string;
  operationId?: string;
  state?: AgentState;
  artifacts?: Record<string, string>;
  /**
   * Absolute paths of the target's workspace. Emitted on every command that
   * loads a config so an assistant never has to guess where a file belongs.
   */
  workspace?: Record<string, string>;
  warnings: string[];
  nextActions: NextAction[];
  [key: string]: unknown;
}

export interface AgentErrorResponse {
  ok: false;
  error: AgentErrorDetail;
}

export type AgentResponse = AgentSuccessResponse | AgentErrorResponse;

/** Thrown by agent-facing code to attach a stable code and retryability. */
export class AgentError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(code: string, message: string, retryable = false, details?: unknown) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

/** Map any thrown value to the stable error envelope detail. */
export function normalizeAgentError(error: unknown): AgentErrorDetail {
  if (error instanceof AgentError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof ConfigValidationError) {
    return { code: "CONFIG_VALIDATION", message: error.message, retryable: false };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message, retryable: false };
  }
  return { code: "UNKNOWN_ERROR", message: String(error), retryable: false };
}

/**
 * Build the success envelope. `ok` is always true: the envelope reports
 * protocol-level success, while an operation's outcome (e.g. a failed run) is
 * conveyed through payload fields such as `status`, not through `ok`.
 */
export function buildSuccessEnvelope(payload: Record<string, unknown>, warnings: string[]): AgentSuccessResponse {
  const { ok: _ok, ...rest } = payload;
  return {
    ok: true,
    warnings,
    nextActions: [],
    ...rest,
  };
}

export function buildErrorEnvelope(detail: AgentErrorDetail): AgentErrorResponse {
  return { ok: false, error: detail };
}

/** Structural contract check used by the JSON protocol test. */
export function isAgentResponse(value: unknown): value is AgentResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean") return false;
  if (record.ok === true) {
    return Array.isArray(record.warnings) && Array.isArray(record.nextActions);
  }
  // ok === false: an error envelope only needs a structured error detail.
  return typeof record.error === "object" && record.error !== null;
}
