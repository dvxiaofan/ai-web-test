import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { stableStringify, toJsonValue } from "./ids.js";
import type { JsonValue } from "./types.js";

export class JsonFileError extends Error {
  readonly filePath: string;
  override readonly cause?: unknown;

  constructor(message: string, filePath: string, cause?: unknown) {
    super(message);
    this.name = "JsonFileError";
    this.filePath = filePath;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export async function readJsonFile<T = JsonValue>(filePath: string): Promise<T> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new JsonFileError(`Unable to read JSON file: ${filePath}`, filePath, error);
  }

  try {
    return JSON.parse(stripByteOrderMark(source)) as T;
  } catch (error) {
    throw new JsonFileError(`Invalid JSON in file: ${filePath}`, filePath, error);
  }
}

export interface WriteJsonOptions {
  pretty?: boolean | number;
  atomic?: boolean;
  trailingNewline?: boolean;
}

/** Validate and atomically persist canonical JSON by default. */
export async function writeJsonFile(filePath: string, value: unknown, options: WriteJsonOptions = {}): Promise<void> {
  const pretty = options.pretty ?? true;
  const trailingNewline = options.trailingNewline ?? true;
  const atomic = options.atomic ?? true;
  const indentation = typeof pretty === "number" ? pretty : pretty ? 2 : 0;
  const content = `${stableStringify(toJsonValue(value), indentation)}${trailingNewline ? "\n" : ""}`;

  await mkdir(path.dirname(filePath), { recursive: true });
  if (!atomic) {
    await writeFile(filePath, content, "utf8");
    return;
  }

  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new JsonFileError(`Unable to write JSON file: ${filePath}`, filePath, error);
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function stripByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
