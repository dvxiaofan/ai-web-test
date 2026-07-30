import { readFile } from "node:fs/promises";
import path from "node:path";

import { contentDigest, stableId } from "../core/ids.js";
import type {
  ApiInventoryNode,
  ComponentInventoryNode,
  EvidenceRef,
  Finding,
  GuardInventoryNode,
  Inventory,
  InventoryCoverage,
  InventoryEdge,
  InventoryNode,
  ModuleInventoryNode,
  PageInventoryNode,
  ProjectInventoryNode,
  RoleInventoryNode,
  RouteInventoryNode,
  SourceLocation,
  StoreInventoryNode,
  TestInventoryNode,
} from "../core/types.js";
import { classifySourceFile, inferModuleName } from "./classify.js";
import { detectFramework, detectPackageManager } from "./detection.js";
import { extractApiOperations } from "./apis.js";
import { discoverFileSystemRoutes, extractConfiguredRoutes } from "./routes.js";
import type {
  DiscoverSourceOptions,
  DiscoveredApiOperation,
  DiscoveredModule,
  DiscoveredRoute,
  DiscoveryNotice,
  FrameworkDetection,
  PackageManagerDetection,
  SourceDiscoveryDraft,
  SourceFileDescriptor,
} from "./types.js";
import { walkSourceFiles } from "./walker.js";

const MAX_READ_BYTES = 8 * 1024 * 1024;

export async function discoverSource(options: DiscoverSourceOptions): Promise<SourceDiscoveryDraft> {
  const walk = await walkSourceFiles(options);
  const detectedFramework = await detectFramework(walk.rootDir);
  const detectedPackageManager = await detectPackageManager(walk.rootDir);
  const framework = options.framework === undefined
    ? detectedFramework
    : { framework: options.framework, confidence: 1, evidence: ["framework supplied by operator"] } satisfies FrameworkDetection;
  const packageManager = options.packageManager === undefined
    ? detectedPackageManager
    : { packageManager: options.packageManager, confidence: 1, evidence: ["package manager supplied by operator"] } satisfies PackageManagerDetection;

  const notices: DiscoveryNotice[] = [];
  const fileTexts = new Map<string, string>();
  const files = walk.files.map((file) => ({ ...file }));
  for (const file of files) {
    try {
      if (file.sizeBytes > MAX_READ_BYTES) {
        notices.push({
          level: "warning",
          code: "source-file-too-large",
          message: `Skipped parsing ${file.relativePath}: file exceeds ${MAX_READ_BYTES} bytes.`,
          source: { filePath: file.relativePath, line: 1, column: 1 },
        });
        continue;
      }
      const text = await readFile(file.absolutePath, "utf8");
      fileTexts.set(file.relativePath, text);
      file.classifications = classifySourceFile(file, text);
      file.moduleName = inferModuleName(file.relativePath);
    } catch (error) {
      notices.push({
        level: "warning",
        code: "source-file-unreadable",
        message: `Could not read ${file.relativePath}: ${errorMessage(error)}`,
        source: { filePath: file.relativePath, line: 1, column: 1 },
      });
    }
  }

  const configuredRoutes: DiscoveredRoute[] = [];
  const apiOperations: DiscoveredApiOperation[] = [];
  for (const file of files) {
    const text = fileTexts.get(file.relativePath);
    if (text === undefined) continue;
    configuredRoutes.push(...extractConfiguredRoutes(file.relativePath, text, framework.framework, file.moduleName));
    apiOperations.push(...extractApiOperations(file.relativePath, text, file.moduleName));
  }
  const fileRoutes = discoverFileSystemRoutes(files, framework.framework);
  const routes = mergeRoutes([...configuredRoutes, ...fileRoutes]);
  const modules = buildModules(files, routes, apiOperations);
  const buildInput: BuildInventoryInput = {
    rootDir: walk.rootDir,
    projectName: options.projectName ?? await projectNameFromPackage(walk.rootDir) ?? path.basename(walk.rootDir),
    framework,
    packageManager,
    files,
    fileTexts,
    routes,
    apiOperations,
    modules,
    walk,
    notices,
    generatedAt: (options.now ?? new Date()).toISOString(),
  };
  if (options.baseUrl !== undefined) buildInput.baseUrl = options.baseUrl;
  const inventory = buildInventory(buildInput);

  for (const skipped of walk.skipped) {
    if (skipped.reason === "ignored" || skipped.reason === "unsupported-extension") continue;
    notices.push({
      level: "warning",
      code: `walk-${skipped.reason}`,
      message: `Discovery skipped ${skipped.path}${skipped.detail === undefined ? "" : `: ${skipped.detail}`}.`,
      source: { filePath: skipped.path, line: 1, column: 1 },
    });
  }
  if (walk.truncated) {
    notices.push({
      level: "warning",
      code: "walk-truncated",
      message: "Source discovery reached a configured safety limit; inventory may be incomplete.",
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: inventory.generatedAt,
    rootDir: walk.rootDir,
    framework,
    packageManager,
    files,
    routes,
    apiOperations,
    modules,
    notices,
    stats: {
      filesScanned: files.length,
      bytesScanned: walk.totalBytes,
      routesDiscovered: routes.length,
      apiOperationsDiscovered: apiOperations.length,
      modulesDiscovered: modules.length,
      skippedEntries: walk.skipped.length,
      truncated: walk.truncated,
    },
    inventory,
  };
}

interface BuildInventoryInput {
  rootDir: string;
  projectName: string;
  baseUrl?: string;
  framework: FrameworkDetection;
  packageManager: PackageManagerDetection;
  files: SourceFileDescriptor[];
  fileTexts: ReadonlyMap<string, string>;
  routes: DiscoveredRoute[];
  apiOperations: DiscoveredApiOperation[];
  modules: DiscoveredModule[];
  walk: Awaited<ReturnType<typeof walkSourceFiles>>;
  notices: DiscoveryNotice[];
  generatedAt: string;
}

export function buildInventory(input: BuildInventoryInput): Inventory {
  const fileDigest = contentDigest(
    Object.fromEntries(
      [...input.fileTexts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  const inventoryId = stableId("inventory", input.rootDir, fileDigest);
  const projectId = stableId("project", input.rootDir);
  const project: ProjectInventoryNode = {
    id: projectId,
    kind: "project",
    name: input.projectName,
    rootDir: input.rootDir,
    framework: input.framework.framework,
    packageManager: input.packageManager.packageManager,
    tags: ["static-discovery"],
    confidence: Math.min(input.framework.confidence, input.packageManager.confidence),
    evidence: [
      evidence("source", `Detected ${input.framework.framework} project`, input.framework.confidence),
      evidence("source", `Detected ${input.packageManager.packageManager} package manager`, input.packageManager.confidence),
    ],
  };

  const nodes: InventoryNode[] = [project];
  const edges: InventoryEdge[] = [];
  const moduleNodes = new Map<string, ModuleInventoryNode>();
  for (const module of input.modules) {
    const node: ModuleInventoryNode = {
      id: module.id,
      kind: "module",
      name: module.name,
      sourcePaths: module.sourcePaths,
      routeIds: module.routeIds,
      apiIds: module.apiIds,
      moduleId: module.id,
      tags: ["source-module"],
      confidence: 0.82,
      evidence: module.sourcePaths.map((filePath) => evidence("source", `Inferred module from ${filePath}`, 0.82, { filePath, line: 1, column: 1 })),
    };
    moduleNodes.set(module.name, node);
    nodes.push(node);
    addEdge(edges, project.id, node.id, "contains", node.evidence);
  }

  const pageByPath = new Map<string, PageInventoryNode>();
  for (const route of input.routes) {
    const pageId = stableId("page", route.path);
    let page = pageByPath.get(route.path);
    if (page === undefined) {
      const newPage: PageInventoryNode = {
        id: pageId,
        kind: "page",
        name: route.name ?? route.path,
        routePaths: [route.path],
        entryFile: route.source.filePath,
        componentIds: [],
        operationIds: [],
        tags: ["discovered-page"],
        confidence: route.confidence,
        evidence: [evidence("source", `Route ${route.path} discovered`, route.confidence, route.source)],
      };
      const pageModuleId = moduleNodes.get(route.moduleName)?.id;
      if (pageModuleId !== undefined) newPage.moduleId = pageModuleId;
      page = newPage;
      pageByPath.set(route.path, newPage);
      nodes.push(newPage);
      addEdge(edges, project.id, newPage.id, "contains", newPage.evidence);
      const module = moduleNodes.get(route.moduleName);
      if (module !== undefined) addEdge(edges, module.id, newPage.id, "contains", newPage.evidence);
    } else {
      page.evidence.push(evidence("source", `Additional route evidence for ${route.path}`, route.confidence, route.source));
      if (!page.routePaths.includes(route.path)) page.routePaths.push(route.path);
    }

    const routeNode: RouteInventoryNode = {
      id: route.id,
      kind: "route",
      name: route.name ?? route.path,
      path: route.path,
      entryFile: route.source.filePath,
      pageId: page.id,
      requiresAuth: route.requiresAuth,
      roleIds: [],
      tags: [route.kind, ...(route.requiresAuth ? ["authenticated"] : [])],
      confidence: route.confidence,
      evidence: [evidence("source", `Route ${route.path} found in ${route.source.filePath}`, route.confidence, route.source)],
    };
    const routeModuleId = moduleNodes.get(route.moduleName)?.id;
    if (routeModuleId !== undefined) routeNode.moduleId = routeModuleId;
    nodes.push(routeNode);
    addEdge(edges, page.id, routeNode.id, "renders", routeNode.evidence);
    const module = moduleNodes.get(route.moduleName);
    if (module !== undefined) addEdge(edges, module.id, routeNode.id, "contains", routeNode.evidence);

    for (const role of route.roles) {
      const roleNode = ensureRole(nodes, role, route.source);
      routeNode.roleIds.push(roleNode.id);
      addEdge(edges, routeNode.id, roleNode.id, "requires-role", roleNode.evidence);
    }
  }

  const apiByKey = new Map<string, ApiInventoryNode>();
  for (const operation of input.apiOperations) {
    const key = `${operation.method}:${operation.urlPattern}:${operation.operationName ?? ""}`;
    let node = apiByKey.get(key);
    if (node === undefined) {
      const newNode: ApiInventoryNode = {
        id: stableId("api", operation.method, operation.urlPattern, operation.operationName ?? ""),
        kind: "api",
        name: operation.operationName ?? `${operation.method} ${operation.urlPattern}`,
        method: operation.method,
        urlPattern: operation.urlPattern,
        sourceFile: operation.source.filePath,
        observed: false,
        tags: [operation.transport],
        confidence: operation.confidence,
        evidence: [],
      };
      if (operation.operationName !== undefined) newNode.operationName = operation.operationName;
      const apiModuleId = moduleNodes.get(operation.moduleName)?.id;
      if (apiModuleId !== undefined) newNode.moduleId = apiModuleId;
      node = newNode;
      apiByKey.set(key, newNode);
      nodes.push(newNode);
      const module = moduleNodes.get(operation.moduleName);
      if (module !== undefined) addEdge(edges, module.id, newNode.id, "contains", newNode.evidence);
    }
    node.evidence.push(evidence("source", `${operation.transport} ${operation.method} ${operation.urlPattern}`, operation.confidence, operation.source));
    if (!node.tags.includes(operation.transport)) node.tags.push(operation.transport);
    const page = pageByPath.get(routePathForSource(input.routes, operation.source.filePath));
    if (page !== undefined && !page.operationIds.includes(node.id)) {
      page.operationIds.push(node.id);
      addEdge(edges, page.id, node.id, "calls", node.evidence);
    }
  }

  for (const file of input.files) {
    const source = { filePath: file.relativePath, line: 1, column: 1 };
    const moduleId = moduleNodes.get(file.moduleName)?.id;
    for (const classification of file.classifications) {
      if (classification === "component" || classification === "layout") {
        const node: ComponentInventoryNode = {
          id: stableId("component", file.relativePath),
          kind: "component",
          name: path.posix.basename(file.relativePath).replace(/\.[^.]+$/, ""),
          sourceFile: file.relativePath,
          componentType: classification === "layout" ? "layout" : componentType(file.relativePath, input.fileTexts.get(file.relativePath)),
          interactive: /\b(button|input|form|onClick|@click|v-model)\b/i.test(input.fileTexts.get(file.relativePath) ?? ""),
          tags: [classification],
          confidence: 0.72,
          evidence: [evidence("source", `Classified ${file.relativePath} as ${classification}`, 0.72, source)],
        };
        if (moduleId !== undefined) node.moduleId = moduleId;
        nodes.push(node);
        const page = pageByPath.get(routePathForSource(input.routes, file.relativePath));
        if (page !== undefined && !page.componentIds.includes(node.id)) {
          page.componentIds.push(node.id);
          addEdge(edges, page.id, node.id, "renders", node.evidence);
        }
        if (moduleId !== undefined) addEdge(edges, moduleId, node.id, "contains", node.evidence);
      } else if (classification === "store") {
        const node: StoreInventoryNode = {
          id: stableId("store", file.relativePath),
          kind: "store",
          name: path.posix.basename(file.relativePath).replace(/\.[^.]+$/, ""),
          sourceFile: file.relativePath,
          storeType: storeType(input.fileTexts.get(file.relativePath)),
          tags: ["store"],
          confidence: 0.75,
          evidence: [evidence("source", `Classified ${file.relativePath} as a store`, 0.75, source)],
        };
        if (moduleId !== undefined) node.moduleId = moduleId;
        nodes.push(node);
        if (moduleId !== undefined) addEdge(edges, moduleId, node.id, "contains", node.evidence);
      } else if (classification === "guard") {
        const node: GuardInventoryNode = {
          id: stableId("guard", file.relativePath),
          kind: "guard",
          name: path.posix.basename(file.relativePath).replace(/\.[^.]+$/, ""),
          sourceFile: file.relativePath,
          guardedPaths: input.routes.filter((route) => route.source.filePath === file.relativePath).map((route) => route.path),
          roleIds: [],
          tags: ["guard"],
          confidence: 0.7,
          evidence: [evidence("source", `Classified ${file.relativePath} as a guard`, 0.7, source)],
        };
        if (moduleId !== undefined) node.moduleId = moduleId;
        nodes.push(node);
        if (moduleId !== undefined) addEdge(edges, moduleId, node.id, "contains", node.evidence);
      } else if (classification === "test") {
        const node: TestInventoryNode = {
          id: stableId("test", file.relativePath),
          kind: "test",
          name: path.posix.basename(file.relativePath),
          sourceFile: file.relativePath,
          framework: testFramework(input.fileTexts.get(file.relativePath)),
          scenarioIds: [],
          tags: ["existing-test"],
          confidence: 0.9,
          evidence: [evidence("source", `Existing test file ${file.relativePath}`, 0.9, source)],
        };
        if (moduleId !== undefined) node.moduleId = moduleId;
        nodes.push(node);
        if (moduleId !== undefined) addEdge(edges, moduleId, node.id, "contains", node.evidence);
      }
    }
  }

  const findings = buildDiscoveryFindings(input);
  const coverage: InventoryCoverage = {
    routes: { discovered: input.routes.length, visited: 0, rendered: 0 },
    pages: { discovered: pageByPath.size, rendered: 0, withScenario: 0 },
    apis: { discovered: apiByKey.size, observed: 0, asserted: 0 },
    roles: { configured: nodes.filter((node): node is RoleInventoryNode => node.kind === "role").length, exercised: 0 },
    scenarios: { discovered: 0, proposed: 0, approved: 0 },
    unresolved: input.walk.skipped.filter((entry) => entry.reason !== "ignored" && entry.reason !== "unsupported-extension").length,
  };

  const projectInfo: Inventory["project"] = {
    id: projectId,
    name: input.projectName,
    rootDir: input.rootDir,
    framework: input.framework.framework,
    packageManager: input.packageManager.packageManager,
  };
  if (input.baseUrl !== undefined) Object.assign(projectInfo, { baseUrl: input.baseUrl });
  const inventory: Inventory = {
    schemaVersion: 1,
    id: inventoryId,
    project: projectInfo,
    generatedAt: input.generatedAt,
    sourceDigest: fileDigest,
    nodes,
    edges: dedupeEdges(edges),
    findings,
    coverage,
    metadata: {
      discoveryMode: "static-source",
      frameworkEvidence: input.framework.evidence.join("; "),
      packageManagerEvidence: input.packageManager.evidence.join("; "),
      noticeCount: input.notices.length,
    },
  };
  if (input.baseUrl !== undefined) inventory.runtimeBaseUrl = input.baseUrl;
  return inventory;
}

/**
 * Seed inventory for `runtime-first` (black-box) discovery: there is no source
 * tree to parse, so the inventory starts with only a project node and is later
 * filled in by browser exploration and/or `aitest inventory merge`.
 */
export function createRuntimeFirstInventory(input: {
  projectName: string;
  baseUrl: string;
  rootDir?: string;
  generatedAt?: string;
}): Inventory {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projectId = stableId("project", input.baseUrl);
  const projectNode: ProjectInventoryNode = {
    id: projectId,
    kind: "project",
    name: input.projectName,
    rootDir: input.rootDir ?? "",
    tags: ["runtime-first"],
    confidence: 1,
    evidence: [
      {
        id: stableId("evidence", "runtime-first", input.baseUrl),
        kind: "runtime",
        summary: `runtime-first discovery seeded from ${input.baseUrl}`,
        confidence: 1,
        observedAt: generatedAt,
        uri: input.baseUrl,
      },
    ],
  };

  const coverage: InventoryCoverage = {
    routes: { discovered: 0, visited: 0, rendered: 0 },
    pages: { discovered: 0, rendered: 0, withScenario: 0 },
    apis: { discovered: 0, observed: 0, asserted: 0 },
    roles: { configured: 0, exercised: 0 },
    scenarios: { discovered: 0, proposed: 0, approved: 0 },
    unresolved: 0,
  };

  return {
    schemaVersion: 1,
    id: stableId("inventory", input.baseUrl, generatedAt),
    project: {
      id: projectId,
      name: input.projectName,
      rootDir: input.rootDir ?? "",
      baseUrl: input.baseUrl,
    },
    generatedAt,
    runtimeBaseUrl: input.baseUrl,
    nodes: [projectNode],
    edges: [],
    findings: [],
    coverage,
    metadata: { discoveryMode: "runtime-first" },
  };
}

export function buildModules(
  files: readonly SourceFileDescriptor[],
  routes: readonly DiscoveredRoute[],
  apiOperations: readonly DiscoveredApiOperation[],
): DiscoveredModule[] {
  const names = new Set<string>(files.map((file) => file.moduleName));
  for (const route of routes) names.add(route.moduleName);
  for (const operation of apiOperations) names.add(operation.moduleName);
  return [...names]
    .filter((name) => name.length > 0)
    .sort()
    .map((name) => {
      const sourcePaths = files.filter((file) => file.moduleName === name).map((file) => file.relativePath);
      const routeIds = routes.filter((route) => route.moduleName === name).map((route) => route.id);
      const apiIds = apiOperations
        .filter((operation) => operation.moduleName === name)
        .map((operation) => stableId("api", operation.method, operation.urlPattern, operation.operationName ?? ""));
      return {
        id: stableId("module", name),
        name,
        sourcePaths,
        routeIds: [...new Set(routeIds)],
        apiIds: [...new Set(apiIds)],
      };
    });
}

function mergeRoutes(routes: DiscoveredRoute[]): DiscoveredRoute[] {
  const byKey = new Map<string, DiscoveredRoute>();
  for (const route of routes) {
    const key = `${route.path}:${route.source.filePath}:${route.source.line ?? 0}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, route);
      continue;
    }
    existing.requiresAuth ||= route.requiresAuth;
    existing.roles = [...new Set([...existing.roles, ...route.roles])];
    if (existing.component === undefined && route.component !== undefined) existing.component = route.component;
    if (route.confidence > existing.confidence) existing.confidence = route.confidence;
  }
  return [...byKey.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function ensureRole(nodes: InventoryNode[], role: string, source: SourceLocation): RoleInventoryNode {
  const roleKey = role.trim();
  const existing = nodes.find((node): node is RoleInventoryNode => node.kind === "role" && node.roleKey === roleKey);
  if (existing !== undefined) {
    existing.evidence.push(evidence("source", `Role ${roleKey} referenced by a route`, 0.8, source));
    return existing;
  }
  const node: RoleInventoryNode = {
    id: stableId("role", roleKey),
    kind: "role",
    name: roleKey,
    roleKey,
    permissions: [],
    authenticated: true,
    tags: ["discovered-role"],
    confidence: 0.8,
    evidence: [evidence("source", `Role ${roleKey} referenced by a route`, 0.8, source)],
  };
  nodes.push(node);
  return node;
}

function addEdge(edges: InventoryEdge[], from: string, to: string, relationship: InventoryEdge["relationship"], refs: EvidenceRef[]): void {
  edges.push({ id: stableId("edge", from, relationship, to), from, to, relationship, confidence: refs[0]?.confidence ?? 0.5, evidence: refs.slice(0, 3) });
}

function dedupeEdges(edges: InventoryEdge[]): InventoryEdge[] {
  const byId = new Map<string, InventoryEdge>();
  for (const edge of edges) byId.set(edge.id, edge);
  return [...byId.values()];
}

function evidence(kind: EvidenceRef["kind"], summary: string, confidence: number, source?: SourceLocation): EvidenceRef {
  const result: EvidenceRef = { id: stableId("evidence", kind, summary, source?.filePath ?? "", source?.line ?? 0), kind, summary, confidence };
  if (source !== undefined) result.source = source;
  return result;
}

function buildDiscoveryFindings(input: BuildInventoryInput): Finding[] {
  const findings: Finding[] = [];
  for (const skipped of input.walk.skipped) {
    if (skipped.reason === "ignored" || skipped.reason === "unsupported-extension") continue;
    const source = { filePath: skipped.path, line: 1, column: 1 };
    findings.push({
      id: stableId("finding", "discovery", skipped.reason, skipped.path),
      category: "discovery",
      classification: "coverage-gap",
      severity: skipped.reason === "outside-root" ? "high" : "medium",
      status: "open",
      confidence: 0.95,
      title: `Discovery skipped ${skipped.path}`,
      summary: skipped.detail ?? `Entry was skipped because of ${skipped.reason}.`,
      evidence: [evidence("source", `Walker skipped ${skipped.path}`, 0.95, source)],
      relatedIds: [],
      source,
      createdAt: input.generatedAt,
    });
  }
  if (input.walk.truncated) {
    findings.push({
      id: stableId("finding", "discovery", "truncated", input.rootDir),
      category: "discovery",
      classification: "coverage-gap",
      severity: "high",
      status: "open",
      confidence: 0.99,
      title: "Static discovery was truncated",
      summary: "One or more walker safety limits were reached; coverage is incomplete.",
      evidence: [evidence("source", "Walker safety limit reached", 0.99)],
      relatedIds: [],
      createdAt: input.generatedAt,
    });
  }
  return findings;
}

function routePathForSource(routes: readonly DiscoveredRoute[], sourceFile: string): string {
  return routes.find((route) => route.source.filePath === sourceFile)?.path ?? "";
}

function componentType(filePath: string, sourceText: string | undefined): NonNullable<ComponentInventoryNode["componentType"]> {
  const lower = filePath.toLowerCase();
  if (/form|input|field/.test(lower) || /<form\b|useform|v-model/.test(sourceText ?? "")) return "form";
  if (/table|grid|list/.test(lower)) return "table";
  if (/modal|dialog|drawer/.test(lower)) return "modal";
  return "unknown";
}

function storeType(sourceText: string | undefined): string {
  const text = sourceText ?? "";
  if (/defineStore/.test(text)) return "pinia";
  if (/createSlice|configureStore/.test(text)) return "redux";
  if (/zustand|create\s*<.*>\s*\(/.test(text)) return "zustand";
  return "custom";
}

function testFramework(sourceText: string | undefined): string {
  const text = sourceText ?? "";
  if (/playwright|@playwright/.test(text)) return "playwright";
  if (/cypress/.test(text)) return "cypress";
  if (/vitest/.test(text)) return "vitest";
  if (/jest/.test(text)) return "jest";
  return "unknown";
}

async function projectNameFromPackage(rootDir: string): Promise<string | undefined> {
  try {
    const text = await readFile(path.join(rootDir, "package.json"), "utf8");
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const name = (value as Record<string, unknown>).name;
      return typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined;
    }
  } catch {
    // Package metadata is optional; the directory name is a safe fallback.
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
