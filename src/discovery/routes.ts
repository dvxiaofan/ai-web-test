import path from "node:path";

import ts from "typescript";

import { stableId } from "../core/ids.js";
import {
  collectStaticConstants,
  expressionStrings,
  objectProperty,
  parseSourceText,
  propertyName,
  sourceLocation,
  staticBoolean,
  staticString,
  unwrapExpression,
} from "./ast.js";
import { inferRouteModule } from "./classify.js";
import type {
  DiscoveredRoute,
  FrameworkName,
  SourceFileDescriptor,
} from "./types.js";

const ROUTE_OBJECT_PROPERTIES = new Set([
  "name",
  "component",
  "components",
  "element",
  "children",
  "meta",
  "loader",
  "action",
  "redirect",
  "beforeenter",
  "lazy",
  "index",
]);

export function extractConfiguredRoutes(
  relativePath: string,
  sourceText: string,
  framework: FrameworkName,
  sourceModule: string,
): DiscoveredRoute[] {
  const results: DiscoveredRoute[] = [];

  for (const parsed of parseSourceText(relativePath, sourceText)) {
    const sourceFile = parsed.sourceFile;
    const constants = collectStaticConstants(sourceFile);
    const processedObjects = new Set<number>();

    const processContainer = (array: ts.ArrayLiteralExpression, parentPath: string): void => {
      for (const element of array.elements) {
        const expression = ts.isExpression(element) ? unwrapExpression(element) : undefined;
        if (expression !== undefined && ts.isObjectLiteralExpression(expression)) {
          processRouteObject(expression, parentPath);
        }
      }
    };

    const processRouteObject = (object: ts.ObjectLiteralExpression, parentPath: string): void => {
      if (processedObjects.has(object.pos)) return;
      processedObjects.add(object.pos);

      const pathExpression = objectProperty(object, "path");
      const indexRoute = staticBoolean(objectProperty(object, "index")) === true;
      const rawPath = staticString(pathExpression, sourceFile, constants);
      if (rawPath === undefined && !indexRoute) return;

      const routePath = indexRoute ? normalizeRoutePath(parentPath) : joinRoutePath(parentPath, rawPath ?? "");
      const name = staticString(objectProperty(object, "name"), sourceFile, constants);
      const componentExpression =
        objectProperty(object, "component") ??
        objectProperty(object, "element") ??
        objectProperty(object, "components") ??
        objectProperty(object, "lazy");
      const component = compactNodeText(componentExpression, sourceFile);
      const roles = collectRoles(object, sourceFile, constants);
      const requiresAuth = inferRequiresAuth(object, componentExpression, sourceFile) || roles.length > 0;
      const location = sourceLocation(relativePath, object, sourceFile, parsed.lineOffset);

      const route: DiscoveredRoute = {
        id: stableId("route-source", routePath, location.filePath, location.line, "configured"),
        path: routePath,
        source: location,
        kind: "configured",
        framework,
        moduleName: inferRouteModule(routePath, sourceModule),
        requiresAuth,
        roles,
        confidence: 0.93,
      };
      if (name !== undefined) route.name = name;
      if (component !== undefined) route.component = component;
      results.push(route);

      const children = objectProperty(object, "children");
      if (children !== undefined) {
        const unwrapped = unwrapExpression(children);
        if (ts.isArrayLiteralExpression(unwrapped)) processContainer(unwrapped, routePath);
      }
    };

    const visit = (node: ts.Node): void => {
      if (ts.isArrayLiteralExpression(node) && isRouteArray(node, sourceFile, constants)) {
        processContainer(node, "/");
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const visitJsx = (node: ts.Node, parentPath = "/", insideRoute = false): void => {
      if (ts.isJsxElement(node) && isRouteTag(node.openingElement.tagName)) {
        const route = routeFromJsxElement(
          relativePath,
          node.openingElement,
          sourceFile,
          parsed.lineOffset,
          framework,
          sourceModule,
          parentPath,
        );
        const nextParent = route?.path ?? parentPath;
        if (route !== undefined) results.push(route);
        for (const child of node.children) visitJsx(child, nextParent, true);
        return;
      }
      if (ts.isJsxSelfClosingElement(node) && isRouteTag(node.tagName)) {
        const route = routeFromJsxElement(
          relativePath,
          node,
          sourceFile,
          parsed.lineOffset,
          framework,
          sourceModule,
          parentPath,
        );
        if (route !== undefined) results.push(route);
        return;
      }
      // Do not lose routes wrapped in fragments, expressions or Routes.
      ts.forEachChild(node, (child) => visitJsx(child, parentPath, insideRoute));
    };
    visitJsx(sourceFile);
  }

  return dedupeRoutes(results);
}

export function discoverFileSystemRoutes(
  files: readonly SourceFileDescriptor[],
  framework: FrameworkName,
): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const file of files) {
    const routePath = fileRoutePath(file.relativePath, framework);
    if (routePath === undefined) continue;
    const source = { filePath: file.relativePath, line: 1, column: 1 };
    routes.push({
      id: stableId("route-source", routePath, file.relativePath, "file-system"),
      path: routePath,
      component: file.relativePath,
      source,
      kind: "file-system",
      framework,
      moduleName: inferRouteModule(routePath, file.moduleName),
      requiresAuth: false,
      roles: [],
      confidence: 0.98,
    });
  }
  return dedupeRoutes(routes);
}

export function fileRoutePath(relativePath: string, framework: FrameworkName): string | undefined {
  const normalized = relativePath.replaceAll("\\", "/");
  const extension = "(?:[cm]?[jt]sx?|vue)";

  if (framework === "next") {
    const appMatch = new RegExp(`^(?:src/)?app(?:/(.*))?/page\\.${extension}$`, "i").exec(normalized);
    if (appMatch !== null) return routeFromSegments(appMatch[1]?.split("/") ?? [], "next-app");

    const pagesMatch = new RegExp(`^(?:src/)?pages/(.+)\\.${extension}$`, "i").exec(normalized);
    if (pagesMatch !== null) {
      const value = pagesMatch[1] ?? "";
      if (value.startsWith("api/") || /^_(app|document|error)$/.test(value)) return undefined;
      if (/^(404|500)$/.test(value)) return undefined;
      return routeFromSegments(value.split("/"), "next-pages");
    }
  }

  if (framework === "nuxt") {
    const pagesMatch = new RegExp(`^(?:src/)?pages/(.+)\\.${extension}$`, "i").exec(normalized);
    if (pagesMatch !== null) return routeFromSegments((pagesMatch[1] ?? "").split("/"), "nuxt");
  }

  return undefined;
}

function isRouteArray(
  array: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
): boolean {
  return array.elements.some((element) => {
    if (!ts.isExpression(element)) return false;
    const value = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(value)) return false;
    const pathExpression = objectProperty(value, "path");
    const hasPath = staticString(pathExpression, sourceFile, constants) !== undefined;
    const isIndex = staticBoolean(objectProperty(value, "index")) === true;
    if (!hasPath && !isIndex) return false;
    return value.properties.some((property) => {
      const name = propertyName(property.name)?.toLowerCase();
      return name !== undefined && ROUTE_OBJECT_PROPERTIES.has(name);
    });
  });
}

function routeFromJsxElement(
  relativePath: string,
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  lineOffset: number,
  framework: FrameworkName,
  sourceModule: string,
  parentPath: string,
): DiscoveredRoute | undefined {
  const attributes = new Map<string, ts.JsxAttribute>();
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(sourceFile).toLowerCase(), property);
  }
  const rawPath = jsxAttributeString(attributes.get("path"), sourceFile);
  const indexRoute = attributes.has("index");
  if (rawPath === undefined && !indexRoute) return undefined;

  const routePath = indexRoute ? normalizeRoutePath(parentPath) : joinRoutePath(parentPath, rawPath ?? "");
  const elementText = jsxAttributeExpressionText(attributes.get("element"), sourceFile);
  const component = elementText ?? jsxAttributeExpressionText(attributes.get("component"), sourceFile);
  const roles = [
    ...jsxAttributeStrings(attributes.get("role"), sourceFile),
    ...jsxAttributeStrings(attributes.get("roles"), sourceFile),
  ].filter(uniqueString);
  const requiresAuth =
    attributes.has("requireauth") ||
    attributes.has("protected") ||
    roles.length > 0 ||
    /\b(ProtectedRoute|RequireAuth|AuthGuard)\b/.test(component ?? "");
  const source = sourceLocation(relativePath, element, sourceFile, lineOffset);
  const route: DiscoveredRoute = {
    id: stableId("route-source", routePath, source.filePath, source.line, "jsx"),
    path: routePath,
    source,
    kind: "jsx",
    framework,
    moduleName: inferRouteModule(routePath, sourceModule),
    requiresAuth,
    roles,
    confidence: 0.96,
  };
  if (component !== undefined) route.component = component;
  return route;
}

function collectRoles(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
): string[] {
  const roles: string[] = [];
  const visitObject = (value: ts.ObjectLiteralExpression): void => {
    for (const property of value.properties) {
      const name = propertyName(property.name)?.toLowerCase();
      if (name === "children") continue;
      if (ts.isPropertyAssignment(property)) {
        if (name === "role" || name === "roles" || name === "permission" || name === "permissions") {
          roles.push(...expressionStrings(property.initializer, sourceFile, constants));
        } else {
          const initializer = unwrapExpression(property.initializer);
          if (ts.isObjectLiteralExpression(initializer)) visitObject(initializer);
        }
      }
    }
  };
  visitObject(object);
  return roles.map((role) => role.trim()).filter((role) => role.length > 0).filter(uniqueString);
}

function inferRequiresAuth(
  object: ts.ObjectLiteralExpression,
  component: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): boolean {
  let auth = false;
  const visitObject = (value: ts.ObjectLiteralExpression): void => {
    for (const property of value.properties) {
      const name = propertyName(property.name)?.toLowerCase();
      if (name === "children") continue;
      if (["requiresauth", "auth", "authenticated", "protected"].includes(name ?? "")) {
        if (ts.isPropertyAssignment(property) && staticBoolean(property.initializer) !== false) auth = true;
        if (ts.isShorthandPropertyAssignment(property)) auth = true;
      }
      if (["beforeenter", "guard", "middleware"].includes(name ?? "")) auth = true;
      if (ts.isPropertyAssignment(property)) {
        const initializer = unwrapExpression(property.initializer);
        if (ts.isObjectLiteralExpression(initializer)) visitObject(initializer);
      }
    }
  };
  visitObject(object);
  if (/\b(ProtectedRoute|RequireAuth|AuthGuard|authGuard)\b/.test(compactNodeText(component, sourceFile) ?? "")) auth = true;
  return auth;
}

function routeFromSegments(segments: string[], convention: "next-app" | "next-pages" | "nuxt"): string {
  const converted: string[] = [];
  for (let segment of segments) {
    if (segment.length === 0 || segment === "index") continue;
    segment = segment.replace(/^\(\.\.\.\)|^\(\.\.\)|^\(\.\)/, "");
    if (convention === "next-app" && (/^\(.+\)$/.test(segment) || segment.startsWith("@"))) continue;
    if (/^\[\[\.\.\.(.+)\]\]$/.test(segment)) {
      converted.push(`*${segment.slice(5, -2)}`);
    } else if (/^\[\.\.\.(.+)\]$/.test(segment)) {
      converted.push(`*${segment.slice(4, -1)}`);
    } else if (/^\[(.+)\]$/.test(segment)) {
      converted.push(`:${segment.slice(1, -1)}`);
    } else if (convention === "nuxt" && /^_.+/.test(segment)) {
      converted.push(`:${segment.slice(1)}`);
    } else {
      converted.push(segment);
    }
  }
  return normalizeRoutePath(`/${converted.join("/")}`);
}

function joinRoutePath(parentPath: string, childPath: string): string {
  if (childPath.startsWith("/")) return normalizeRoutePath(childPath);
  return normalizeRoutePath(`${parentPath}/${childPath}`);
}

function normalizeRoutePath(value: string): string {
  const normalized = `/${value}`.replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function jsxAttributeString(attribute: ts.JsxAttribute | undefined, sourceFile: ts.SourceFile): string | undefined {
  if (attribute?.initializer === undefined) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression !== undefined) {
    const constants = collectStaticConstants(sourceFile);
    return staticString(attribute.initializer.expression, sourceFile, constants);
  }
  return undefined;
}

function jsxAttributeExpressionText(attribute: ts.JsxAttribute | undefined, sourceFile: ts.SourceFile): string | undefined {
  if (attribute?.initializer === undefined) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression !== undefined) {
    return compactNodeText(attribute.initializer.expression, sourceFile);
  }
  return undefined;
}

function jsxAttributeStrings(attribute: ts.JsxAttribute | undefined, sourceFile: ts.SourceFile): string[] {
  if (attribute?.initializer === undefined) return [];
  if (ts.isStringLiteral(attribute.initializer)) return [attribute.initializer.text];
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression !== undefined) {
    return expressionStrings(attribute.initializer.expression, sourceFile, collectStaticConstants(sourceFile));
  }
  return [];
}

function isRouteTag(name: ts.JsxTagNameExpression): boolean {
  return name.getText().split(".").at(-1) === "Route";
}

function compactNodeText(node: ts.Node | undefined, sourceFile: ts.SourceFile): string | undefined {
  if (node === undefined) return undefined;
  return node.getText(sourceFile).replace(/\s+/g, " ").trim().slice(0, 240);
}

function dedupeRoutes(routes: DiscoveredRoute[]): DiscoveredRoute[] {
  const seen = new Map<string, DiscoveredRoute>();
  for (const route of routes) {
    const key = `${route.kind}:${route.path}:${route.source.filePath}:${route.source.line ?? 0}`;
    const existing = seen.get(key);
    if (existing === undefined || route.confidence > existing.confidence) seen.set(key, route);
  }
  return [...seen.values()].sort(
    (left, right) => left.path.localeCompare(right.path) || left.source.filePath.localeCompare(right.source.filePath),
  );
}

function uniqueString(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}
