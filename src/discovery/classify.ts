import path from "node:path";

import type { SourceFileClassification, SourceFileDescriptor } from "./types.js";

const GENERIC_PATH_SEGMENTS = new Set([
  "src",
  "app",
  "apps",
  "client",
  "frontend",
  "web",
  "pages",
  "views",
  "components",
  "layouts",
  "routes",
  "router",
  "services",
  "api",
  "apis",
  "stores",
  "store",
  "guards",
  "lib",
]);

export function classifySourceFile(
  descriptor: Pick<SourceFileDescriptor, "relativePath" | "extension">,
  sourceText: string,
): SourceFileClassification[] {
  const relativePath = normalizePath(descriptor.relativePath);
  const lower = relativePath.toLowerCase();
  const basename = path.posix.basename(lower);
  const classifications = new Set<SourceFileClassification>();

  if (/(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(lower) || /\.(test|spec|e2e)\.[^.]+$/.test(lower)) {
    classifications.add("test");
  }
  if (
    /(^|\/)(pages?|views?)(\/|$)/.test(lower) ||
    /(^|\/)app\/.*\/(page|loading|error|not-found)\.[^.]+$/.test(lower) ||
    /(^|\/)(page|view)\.[^.]+$/.test(lower)
  ) {
    classifications.add("page");
  }
  if (/(^|\/)(layout|layouts)\b/.test(lower) || /(^|\/)layout\.[^.]+$/.test(lower)) {
    classifications.add("layout");
  }
  if (
    /(^|\/)(router|routes)(\/|\.|$)/.test(lower) ||
    /\b(createBrowserRouter|createHashRouter|createRouter|useRoutes|RouterProvider)\b/.test(sourceText)
  ) {
    classifications.add("route-config");
  }
  if (
    /(^|\/)(api|apis|services?|clients?)(\/|\.|$)/.test(lower) ||
    /\b(fetch\s*\(|axios(?:\.|\s*\()|gql\s*`|graphql\s*`)\b/.test(sourceText)
  ) {
    classifications.add("api-client");
  }
  if (
    /(^|\/)(store|stores|state)(\/|\.|$)/.test(lower) ||
    /\b(defineStore|createSlice|configureStore|createStore|create\s*<[^>]+>\s*\()/.test(sourceText)
  ) {
    classifications.add("store");
  }
  if (
    /(^|\/)(guards?|middleware)(\/|\.|$)/.test(lower) ||
    /\b(beforeEach|requiresAuth|ProtectedRoute|RequireAuth|CanActivate|defineNuxtRouteMiddleware)\b/.test(sourceText)
  ) {
    classifications.add("guard");
  }

  const isComponentExtension = [".tsx", ".jsx", ".vue"].includes(descriptor.extension);
  const componentLookingName = /^[A-Z][\w-]*\.(tsx|jsx|vue)$/.test(path.posix.basename(relativePath));
  if (
    isComponentExtension &&
    !classifications.has("layout") &&
    (componentLookingName || /(^|\/)(components?|pages?|views?)(\/|$)/.test(lower)) &&
    !classifications.has("route-config")
  ) {
    classifications.add("component");
  }
  if (basename.startsWith("layout.")) classifications.add("layout");
  if (classifications.size === 0) classifications.add("source");

  return [...classifications].sort();
}

export function inferModuleName(relativePath: string): string {
  const normalized = normalizePath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  const lowerParts = parts.map((part) => part.toLowerCase());

  for (const root of ["modules", "features", "domains", "bounded-contexts"] as const) {
    const index = lowerParts.indexOf(root);
    const candidate = index >= 0 ? parts[index + 1] : undefined;
    if (candidate !== undefined) return normalizeModule(candidate);
  }

  const appIndex = lowerParts.indexOf("app");
  if (appIndex >= 0) {
    const candidate = parts.slice(appIndex + 1).find(isMeaningfulRouteSegment);
    if (candidate !== undefined && !/^(page|layout|loading|error)\./i.test(candidate)) {
      return normalizeModule(candidate);
    }
  }

  for (const root of ["pages", "views"] as const) {
    const index = lowerParts.indexOf(root);
    const candidate = index >= 0 ? parts[index + 1] : undefined;
    if (candidate !== undefined && !/^index\./i.test(candidate)) return normalizeModule(candidate);
  }

  if (lowerParts.some((part) => ["components", "lib", "utils", "shared", "common"].includes(part))) {
    return "shared";
  }
  if (lowerParts.some((part) => ["router", "routes"].includes(part))) return "routing";

  const first = parts.find((part, index) => {
    if (index === parts.length - 1) return false;
    return !GENERIC_PATH_SEGMENTS.has(part.toLowerCase()) && !part.startsWith(".");
  });
  return first === undefined ? "root" : normalizeModule(first);
}

export function inferRouteModule(routePath: string, sourceModule: string): string {
  if (!["root", "shared", "routing"].includes(sourceModule)) return sourceModule;
  const segment = routePath
    .split("/")
    .find((part) => part.length > 0 && !part.startsWith(":") && !part.startsWith("*") && !part.startsWith("("));
  return segment === undefined ? "home" : normalizeModule(segment);
}

export function inferApiModule(urlPattern: string, sourceModule: string): string {
  if (!["root", "shared", "routing"].includes(sourceModule)) return sourceModule;
  const parts = urlPattern.split(/[/?#]/).filter(Boolean);
  const apiIndex = parts.findIndex((part) => part.toLowerCase() === "api");
  const candidate = apiIndex >= 0 ? parts[apiIndex + 1] : parts[0];
  if (candidate === undefined || candidate.startsWith("${")) return sourceModule;
  return normalizeModule(candidate);
}

function normalizeModule(value: string): string {
  const withoutExtension = value.replace(/\.[^.]+$/, "");
  return withoutExtension
    .replace(/^\[+|\]+$/g, "")
    .replace(/^_+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "root";
}

function isMeaningfulRouteSegment(value: string): boolean {
  return !value.startsWith("(") && !value.startsWith("@") && !value.startsWith("_");
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}
