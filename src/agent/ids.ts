/**
 * Phase 1.2 — stable identifiers and idempotency.
 *
 * A project is identified deterministically from its target so the same project
 * yields the same id across runs. Each CLI invocation gets a unique operation
 * id, and repeatable operations can be de-duplicated via an idempotency key.
 */

function shortHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export interface ProjectSeed {
  baseUrl?: string;
  rootDir: string;
}

export function deriveProjectId(target: ProjectSeed): string {
  const seed = `${target.baseUrl ?? ""}|${target.rootDir}`;
  return `project_${shortHash(seed)}`;
}

export function generateOperationId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `op_${time}${rand}`;
}

/** Stable key for a repeatable operation, independent of when it runs. */
export function idempotencyKey(namespace: string, inputs: Record<string, unknown>): string {
  const ordered = Object.keys(inputs)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = inputs[key];
      return acc;
    }, {});
  const seed = JSON.stringify(ordered);
  return `${namespace}:${shortHash(seed)}`;
}

/**
 * In-memory registry that maps an idempotency key to the first operation id
 * that claimed it. Repeated identical operations within the TTL reuse the same
 * operation id instead of spawning duplicates.
 */
export class IdempotencyRegistry {
  #entries = new Map<string, { operationId: string; at: number }>();

  constructor(private readonly ttlMs: number = 5 * 60_000) {}

  get(key: string): string | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > this.ttlMs) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.operationId;
  }

  record(key: string, operationId: string): string {
    const existing = this.get(key);
    if (existing) return existing;
    this.#entries.set(key, { operationId, at: Date.now() });
    return operationId;
  }
}
