import type {
  ApiMethod,
  Confidence,
  Inventory,
  InventoryEdge,
  InventoryNode,
  SourceLocation,
} from "../core/types.js";

export type FrameworkName = "next" | "nuxt" | "react" | "vue" | "unknown";
export type PackageManagerName = "pnpm" | "yarn" | "npm" | "bun" | "unknown";

export type SourceFileClassification =
  | "page"
  | "layout"
  | "component"
  | "route-config"
  | "api-client"
  | "store"
  | "guard"
  | "test"
  | "source";

export interface SourceFileDescriptor {
  absolutePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  classifications: SourceFileClassification[];
  moduleName: string;
}

export type WalkSkipReason =
  | "ignored"
  | "hidden"
  | "unsupported-extension"
  | "too-large"
  | "outside-root"
  | "symlink"
  | "unreadable"
  | "file-limit"
  | "byte-limit";

export interface WalkSkippedEntry {
  path: string;
  reason: WalkSkipReason;
  detail?: string;
}

export interface SourceWalkResult {
  rootDir: string;
  files: SourceFileDescriptor[];
  skipped: WalkSkippedEntry[];
  truncated: boolean;
  totalBytes: number;
}

export interface SourceWalkOptions {
  rootDir: string;
  include?: string[];
  ignore?: string[];
  includeExtensions?: string[];
  includeHidden?: boolean;
  followSymlinks?: boolean;
  maxFiles?: number;
  maxFileSizeBytes?: number;
  maxTotalBytes?: number;
}

export interface FrameworkDetection {
  framework: FrameworkName;
  confidence: Confidence;
  version?: string;
  evidence: string[];
}

export interface PackageManagerDetection {
  packageManager: PackageManagerName;
  confidence: Confidence;
  version?: string;
  evidence: string[];
}

export type RouteDiscoveryKind = "configured" | "file-system" | "jsx";

export interface DiscoveredRoute {
  id: string;
  path: string;
  name?: string;
  component?: string;
  source: SourceLocation;
  kind: RouteDiscoveryKind;
  framework: FrameworkName;
  moduleName: string;
  requiresAuth: boolean;
  roles: string[];
  confidence: Confidence;
}

export type ApiTransport = "fetch" | "axios" | "graphql" | "client";

export interface DiscoveredApiOperation {
  id: string;
  method: ApiMethod;
  urlPattern: string;
  operationName?: string;
  source: SourceLocation;
  transport: ApiTransport;
  moduleName: string;
  confidence: Confidence;
}

export interface DiscoveredModule {
  id: string;
  name: string;
  sourcePaths: string[];
  routeIds: string[];
  apiIds: string[];
}

export interface DiscoveryNotice {
  level: "info" | "warning";
  code: string;
  message: string;
  source?: SourceLocation;
}

export interface SourceDiscoveryStats {
  filesScanned: number;
  bytesScanned: number;
  routesDiscovered: number;
  apiOperationsDiscovered: number;
  modulesDiscovered: number;
  skippedEntries: number;
  truncated: boolean;
}

/**
 * Static discovery output. `inventory` is immediately consumable by the core
 * planner while the raw arrays retain call-site detail for adapters and UIs.
 */
export interface SourceDiscoveryDraft {
  schemaVersion: 1;
  generatedAt: string;
  rootDir: string;
  framework: FrameworkDetection;
  packageManager: PackageManagerDetection;
  files: SourceFileDescriptor[];
  routes: DiscoveredRoute[];
  apiOperations: DiscoveredApiOperation[];
  modules: DiscoveredModule[];
  notices: DiscoveryNotice[];
  stats: SourceDiscoveryStats;
  inventory: Inventory;
}

export interface DiscoverSourceOptions extends Omit<SourceWalkOptions, "rootDir"> {
  rootDir: string;
  projectName?: string;
  baseUrl?: string;
  framework?: FrameworkName;
  packageManager?: PackageManagerName;
  now?: Date;
}

export interface InventoryDraftParts {
  nodes: InventoryNode[];
  edges: InventoryEdge[];
}
