import { createHash } from "node:crypto";

import type { JsonObject, JsonValue } from "./types.js";

const ID_PREFIX_PATTERN = /[^a-z0-9_-]+/g;

/** Convert an unknown value into strict JSON data, rejecting lossy values. */
export function toJsonValue(value: unknown): JsonValue {
  return normalizeJson(value, new WeakSet<object>(), "$");
}

/**
 * JSON.stringify with recursively sorted object keys.
 *
 * This is used for artifact digests and IDs, so values that JSON would silently
 * lose (undefined, functions, symbols, circular references and non-finite
 * numbers) are rejected instead of producing a misleading digest.
 */
export function stableStringify(value: unknown, space?: number): string {
  const normalized = toJsonValue(value);
  const indentation = space === undefined ? undefined : Math.max(0, Math.min(10, space));
  return JSON.stringify(normalized, undefined, indentation);
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function contentDigest(value: unknown): string {
  return sha256Text(typeof value === "string" ? value : stableStringify(value));
}

/** Build a readable, deterministic identifier from canonical JSON content. */
export function stableId(namespace: string, ...parts: unknown[]): string {
  const prefix = normalizeIdPrefix(namespace);
  return `${prefix}_${contentDigest(parts).slice(0, 20)}`;
}

export function normalizeIdPrefix(namespace: string): string {
  const normalized = namespace.trim().toLowerCase().replace(ID_PREFIX_PATTERN, "-").replace(/^-+|-+$/g, "");
  if (normalized.length === 0) {
    throw new TypeError("An ID namespace must contain at least one letter or number.");
  }
  return normalized;
}

/**
 * Filesystem-safe slug for directory names derived from human-facing names.
 * CJK characters are kept so Chinese project/module names stay readable.
 */
export function slugifyName(name: string, fallback = "project"): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9一-龥]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function normalizeJson(value: unknown, seen: WeakSet<object>, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path} cannot be represented as JSON.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === "bigint") {
    throw new TypeError(`BigInt at ${path} cannot be represented as JSON.`);
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Unsupported value at ${path} cannot be represented as JSON.`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new TypeError(`Invalid Date at ${path} cannot be represented as JSON.`);
    }
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    detectCycle(value, seen, path);
    try {
      return value.map((item, index) => {
        return normalizeJson(item, seen, `${path}[${index}]`);
      });
    } finally {
      seen.delete(value);
    }
  }

  if (typeof value === "object") {
    detectCycle(value, seen, path);
    try {
      const prototype = Object.getPrototypeOf(value) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`Unsupported object type at ${path}; only plain objects are accepted.`);
      }

      const output: JsonObject = {};
      const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
      for (const [key, item] of entries) {
        output[key] = normalizeJson(item, seen, `${path}.${key}`);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  throw new TypeError(`Unsupported value at ${path} cannot be represented as JSON.`);
}

function detectCycle(value: object, seen: WeakSet<object>, path: string): void {
  if (seen.has(value)) {
    throw new TypeError(`Circular reference detected at ${path}.`);
  }
  seen.add(value);
}
