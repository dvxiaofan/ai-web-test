import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  FrameworkDetection,
  FrameworkName,
  PackageManagerDetection,
  PackageManagerName,
} from "./types.js";

interface PackageJsonShape {
  packageManager?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  scripts?: unknown;
}

export async function detectFramework(rootDir: string): Promise<FrameworkDetection> {
  const packageJson = await readPackageJson(rootDir);
  const dependencies = dependencyMap(packageJson);
  const candidates: Array<{
    framework: Exclude<FrameworkName, "unknown">;
    packageName: string;
    configNames: string[];
    priority: number;
  }> = [
    { framework: "next", packageName: "next", configNames: ["next.config.js", "next.config.mjs", "next.config.ts"], priority: 4 },
    { framework: "nuxt", packageName: "nuxt", configNames: ["nuxt.config.js", "nuxt.config.mjs", "nuxt.config.ts"], priority: 4 },
    { framework: "vue", packageName: "vue", configNames: ["vue.config.js", "vite.config.js", "vite.config.ts"], priority: 2 },
    { framework: "react", packageName: "react", configNames: ["vite.config.js", "vite.config.ts"], priority: 1 },
    { framework: "astro", packageName: "astro", configNames: ["astro.config.js", "astro.config.mjs", "astro.config.ts"], priority: 3 },
  ];

  const matches: Array<{
    framework: Exclude<FrameworkName, "unknown">;
    version?: string;
    evidence: string[];
    score: number;
    priority: number;
  }> = [];

  for (const candidate of candidates) {
    const evidence: string[] = [];
    const version = dependencies.get(candidate.packageName);
    let score = 0;
    if (version !== undefined) {
      evidence.push(`package.json declares ${candidate.packageName}@${version}`);
      score += 0.75;
    }
    for (const configName of candidate.configNames) {
      if (await fileExists(path.join(rootDir, configName))) {
        evidence.push(`found ${configName}`);
        score += candidate.framework === "next" || candidate.framework === "nuxt" ? 0.2 : 0.1;
        break;
      }
    }
    if (score > 0) {
      const item: (typeof matches)[number] = {
        framework: candidate.framework,
        evidence,
        score: Math.min(0.99, score),
        priority: candidate.priority,
      };
      if (version !== undefined) item.version = version;
      matches.push(item);
    }
  }

  matches.sort((left, right) => right.score - left.score || right.priority - left.priority);
  const best = matches[0];
  if (best === undefined) {
    return { framework: "unknown", confidence: 0.2, evidence: ["no supported framework dependency or config found"] };
  }

  const result: FrameworkDetection = {
    framework: best.framework,
    confidence: best.score,
    evidence: best.evidence,
  };
  if (best.version !== undefined) result.version = best.version;
  return result;
}

export async function detectPackageManager(rootDir: string): Promise<PackageManagerDetection> {
  const packageJson = await readPackageJson(rootDir);
  const declared = parsePackageManager(packageJson?.packageManager);
  if (declared !== undefined) {
    const result: PackageManagerDetection = {
      packageManager: declared.name,
      confidence: 0.99,
      evidence: [`package.json packageManager is ${declared.raw}`],
    };
    if (declared.version !== undefined) result.version = declared.version;
    return result;
  }

  const lockfiles: Array<{ names: string[]; manager: Exclude<PackageManagerName, "unknown"> }> = [
    { names: ["pnpm-lock.yaml"], manager: "pnpm" },
    { names: ["yarn.lock"], manager: "yarn" },
    { names: ["package-lock.json", "npm-shrinkwrap.json"], manager: "npm" },
    { names: ["bun.lock", "bun.lockb"], manager: "bun" },
  ];
  for (const candidate of lockfiles) {
    for (const name of candidate.names) {
      if (await fileExists(path.join(rootDir, name))) {
        return {
          packageManager: candidate.manager,
          confidence: 0.95,
          evidence: [`found ${name}`],
        };
      }
    }
  }

  return {
    packageManager: "unknown",
    confidence: 0.2,
    evidence: ["no packageManager field or recognized lockfile found"],
  };
}

async function readPackageJson(rootDir: string): Promise<PackageJsonShape | undefined> {
  try {
    const text = await readFile(path.join(rootDir, "package.json"), "utf8");
    if (text.length > 2 * 1024 * 1024) return undefined;
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? (value as PackageJsonShape) : undefined;
  } catch {
    return undefined;
  }
}

function dependencyMap(packageJson: PackageJsonShape | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const section of [packageJson?.dependencies, packageJson?.devDependencies, packageJson?.peerDependencies]) {
    if (!isRecord(section)) continue;
    for (const [name, value] of Object.entries(section)) {
      if (typeof value === "string") result.set(name, value);
    }
  }
  return result;
}

function parsePackageManager(value: unknown):
  | { name: Exclude<PackageManagerName, "unknown">; raw: string; version?: string }
  | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(npm|pnpm|yarn|bun)(?:@(.+))?$/.exec(value.trim());
  if (match === null) return undefined;
  const name = match[1] as Exclude<PackageManagerName, "unknown">;
  const result: { name: Exclude<PackageManagerName, "unknown">; raw: string; version?: string } = {
    name,
    raw: value.trim(),
  };
  if (match[2] !== undefined) result.version = match[2];
  return result;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
