import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type {
  SourceFileDescriptor,
  SourceWalkOptions,
  SourceWalkResult,
  WalkSkipReason,
} from "./types.js";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  "vendor",
]);

const DEFAULT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".graphql",
  ".gql",
]);

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export async function walkSourceFiles(options: SourceWalkOptions): Promise<SourceWalkResult> {
  const requestedRoot = path.resolve(options.rootDir);
  const rootDir = await realpath(requestedRoot);
  const rootStats = await stat(rootDir);
  if (!rootStats.isDirectory()) {
    throw new TypeError(`Source discovery root is not a directory: ${requestedRoot}`);
  }

  const includeExtensions = new Set(
    (options.includeExtensions ?? [...DEFAULT_EXTENSIONS]).map(normalizeExtension),
  );
  const includeMatchers = (options.include ?? []).map(createIgnoreMatcher);
  const ignoreMatchers = (options.ignore ?? []).map(createIgnoreMatcher);
  const maxFiles = positiveLimit(options.maxFiles, DEFAULT_MAX_FILES, "maxFiles");
  const maxFileSizeBytes = positiveLimit(
    options.maxFileSizeBytes,
    DEFAULT_MAX_FILE_SIZE,
    "maxFileSizeBytes",
  );
  const maxTotalBytes = positiveLimit(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    "maxTotalBytes",
  );

  const files: SourceFileDescriptor[] = [];
  const skipped: SourceWalkResult["skipped"] = [];
  const visitedDirectories = new Set<string>();
  let totalBytes = 0;
  let truncated = false;

  const skip = (entryPath: string, reason: WalkSkipReason, detail?: string): void => {
    const item: SourceWalkResult["skipped"][number] = { path: entryPath, reason };
    if (detail !== undefined) item.detail = detail;
    skipped.push(item);
  };

  const visitDirectory = async (directory: string): Promise<void> => {
    if (truncated) return;

    let canonicalDirectory: string;
    try {
      canonicalDirectory = await realpath(directory);
    } catch (error) {
      skip(toRelative(rootDir, directory), "unreadable", errorMessage(error));
      return;
    }

    if (!isInsideRoot(rootDir, canonicalDirectory)) {
      skip(toRelative(rootDir, directory), "outside-root");
      return;
    }
    if (visitedDirectories.has(canonicalDirectory)) return;
    visitedDirectories.add(canonicalDirectory);

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      skip(toRelative(rootDir, directory), "unreadable", errorMessage(error));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) break;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRelative(rootDir, absolutePath);

      if (shouldIgnore(relativePath, entry.name, entry.isDirectory(), ignoreMatchers)) {
        skip(relativePath, "ignored");
        continue;
      }
      if (!options.includeHidden && entry.name.startsWith(".")) {
        skip(relativePath, "hidden");
        continue;
      }

      let entryStats;
      try {
        entryStats = await lstat(absolutePath);
      } catch (error) {
        skip(relativePath, "unreadable", errorMessage(error));
        continue;
      }

      if (entryStats.isSymbolicLink()) {
        if (!options.followSymlinks) {
          skip(relativePath, "symlink");
          continue;
        }
        let target: string;
        try {
          target = await realpath(absolutePath);
        } catch (error) {
          skip(relativePath, "unreadable", errorMessage(error));
          continue;
        }
        if (!isInsideRoot(rootDir, target)) {
          skip(relativePath, "outside-root");
          continue;
        }
        const targetStats = await stat(target);
        if (targetStats.isDirectory()) {
          await visitDirectory(target);
        } else if (targetStats.isFile()) {
          await addFile(target, relativePath, targetStats.size);
        }
        continue;
      }

      if (entryStats.isDirectory()) {
        await visitDirectory(absolutePath);
      } else if (entryStats.isFile()) {
        await addFile(absolutePath, relativePath, entryStats.size);
      }
    }
  };

  const addFile = async (absolutePath: string, relativePath: string, sizeBytes: number): Promise<void> => {
    if (includeMatchers.length > 0 && !includeMatchers.some((matcher) => matcher(relativePath, false))) {
      skip(relativePath, "ignored", "outside configured include paths");
      return;
    }
    const extension = extensionFor(relativePath);
    if (!includeExtensions.has(extension)) {
      skip(relativePath, "unsupported-extension");
      return;
    }
    if (isGeneratedFile(relativePath)) {
      skip(relativePath, "ignored", "generated or declaration file");
      return;
    }
    if (sizeBytes > maxFileSizeBytes) {
      skip(relativePath, "too-large", `${sizeBytes} bytes`);
      return;
    }
    if (files.length >= maxFiles) {
      truncated = true;
      skip(relativePath, "file-limit", `${maxFiles} files`);
      return;
    }
    if (totalBytes + sizeBytes > maxTotalBytes) {
      truncated = true;
      skip(relativePath, "byte-limit", `${maxTotalBytes} bytes`);
      return;
    }

    // Re-resolve just before accepting the file to avoid following a replaced
    // path outside the root between readdir and lstat.
    let canonicalFile: string;
    try {
      canonicalFile = await realpath(absolutePath);
    } catch (error) {
      skip(relativePath, "unreadable", errorMessage(error));
      return;
    }
    if (!isInsideRoot(rootDir, canonicalFile)) {
      skip(relativePath, "outside-root");
      return;
    }

    files.push({
      absolutePath: canonicalFile,
      relativePath,
      extension,
      sizeBytes,
      classifications: [],
      moduleName: "root",
    });
    totalBytes += sizeBytes;
  };

  await visitDirectory(rootDir);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return { rootDir, files, skipped, truncated, totalBytes };
}

function shouldIgnore(
  relativePath: string,
  name: string,
  isDirectory: boolean,
  matchers: Array<(relativePath: string, isDirectory: boolean) => boolean>,
): boolean {
  if (isDirectory && DEFAULT_IGNORED_DIRECTORIES.has(name)) return true;
  return matchers.some((matcher) => matcher(relativePath, isDirectory));
}

function createIgnoreMatcher(pattern: string): (relativePath: string, isDirectory: boolean) => boolean {
  const normalized = pattern.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "");
  if (normalized.length === 0) return () => false;

  const directoryPattern = normalized.endsWith("/");
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  const regex = globToRegExp(withoutTrailingSlash);
  const basenameOnly = !withoutTrailingSlash.includes("/");

  return (relativePath, isDirectory) => {
    if (directoryPattern && !isDirectory) return false;
    const normalizedPath = relativePath.replaceAll("\\", "/");
    if (regex.test(normalizedPath)) return true;
    if (basenameOnly) {
      return normalizedPath.split("/").some((segment) => regex.test(segment));
    }
    return normalizedPath.startsWith(`${withoutTrailingSlash}/`);
  };
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character ?? "");
    }
  }
  return new RegExp(`${source}$`);
}

function extensionFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".d.ts")) return ".d.ts";
  return path.extname(lower);
}

function normalizeExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function isGeneratedFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith(".d.ts") ||
    lower.endsWith(".min.js") ||
    lower.endsWith(".min.mjs") ||
    lower.includes(".generated.") ||
    lower.includes("/__generated__/")
  );
}

function isInsideRoot(rootDir: string, candidate: string): boolean {
  const relative = path.relative(rootDir, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toRelative(rootDir: string, candidate: string): string {
  const relative = path.relative(rootDir, candidate);
  return (relative || ".").split(path.sep).join("/");
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
