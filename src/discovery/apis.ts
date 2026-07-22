import path from "node:path";

import ts from "typescript";

import { stableId } from "../core/ids.js";
import type { ApiMethod } from "../core/types.js";
import {
  callName,
  collectStaticConstants,
  enclosingOperationName,
  expressionToPattern,
  objectProperty,
  parseSourceText,
  sourceLocation,
  staticString,
  unwrapExpression,
} from "./ast.js";
import { inferApiModule } from "./classify.js";
import type { ApiTransport, DiscoveredApiOperation } from "./types.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const CLIENT_NAME_PATTERN = /(^|\.)(axios|api|apiClient|http|httpClient|requestClient|restClient|client)$/i;

interface GraphqlOperationInfo {
  method: "QUERY" | "MUTATION" | "SUBSCRIPTION";
  operationName?: string;
}

export function extractApiOperations(
  relativePath: string,
  sourceText: string,
  sourceModule: string,
): DiscoveredApiOperation[] {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".graphql" || extension === ".gql") {
    return extractGraphqlFile(relativePath, sourceText, sourceModule);
  }

  const results: DiscoveredApiOperation[] = [];
  for (const parsed of parseSourceText(relativePath, sourceText)) {
    const sourceFile = parsed.sourceFile;
    const constants = collectStaticConstants(sourceFile);
    const axiosNames = new Set<string>(["axios"]);
    const graphqlRequestNames = new Set<string>();
    const gqlTagNames = new Set<string>(["gql", "graphql"]);
    const graphqlDocuments = new Map<string, GraphqlOperationInfo>();

    collectImports(sourceFile, axiosNames, graphqlRequestNames, gqlTagNames);
    collectAxiosInstances(sourceFile, axiosNames);
    collectGraphqlDocuments(sourceFile, gqlTagNames, graphqlDocuments);

    const addOperation = (
      node: ts.Node,
      method: ApiMethod,
      urlPattern: string,
      transport: ApiTransport,
      confidence: number,
      operationName?: string,
    ): void => {
      const location = sourceLocation(relativePath, node, sourceFile, parsed.lineOffset);
      const operation: DiscoveredApiOperation = {
        id: stableId("api-source", method, urlPattern, operationName ?? "", location.filePath, location.line, location.column),
        method: method.toUpperCase(),
        urlPattern: normalizeUrlPattern(urlPattern),
        source: location,
        transport,
        moduleName: inferApiModule(urlPattern, sourceModule),
        confidence,
      };
      if (operationName !== undefined && operationName.length > 0) operation.operationName = operationName;
      results.push(operation);
    };

    const visit = (node: ts.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && isGraphqlTag(node.tag, gqlTagNames)) {
        const documentText = templateText(node.template);
        const info = parseGraphqlOperation(documentText);
        if (info !== undefined) {
          addOperation(
            node,
            info.method,
            "/graphql",
            "graphql",
            0.86,
            info.operationName ?? enclosingVariableName(node),
          );
        }
      }

      if (ts.isCallExpression(node)) {
        const callee = callName(node.expression);
        const lowerCallee = callee.toLowerCase();

        if (lowerCallee === "fetch" || lowerCallee === "window.fetch" || lowerCallee === "globalthis.fetch") {
          const urlPattern = expressionToPattern(node.arguments[0], sourceFile, constants);
          if (urlPattern !== undefined) {
            const options = asObject(node.arguments[1]);
            const method =
              staticString(objectProperty(options, "method"), sourceFile, constants)?.toUpperCase() ?? "GET";
            addOperation(node, method, urlPattern, "fetch", 0.98, enclosingOperationName(node));
          }
        } else {
          const memberCall = memberCallParts(node.expression);
          if (memberCall !== undefined && HTTP_METHODS.has(memberCall.method.toLowerCase()) && isHttpClient(memberCall.owner, axiosNames)) {
            const urlPattern = expressionToPattern(node.arguments[0], sourceFile, constants);
            if (urlPattern !== undefined) {
              const confidence = axiosNames.has(memberCall.owner) ? 0.98 : 0.78;
              addOperation(
                node,
                memberCall.method.toUpperCase(),
                urlPattern,
                axiosNames.has(memberCall.owner) ? "axios" : "client",
                confidence,
                enclosingOperationName(node),
              );
            }
          } else if (memberCall?.method.toLowerCase() === "request" && isHttpClient(memberCall.owner, axiosNames)) {
            const config = asObject(node.arguments[0]);
            const urlPattern = expressionToPattern(objectProperty(config, "url"), sourceFile, constants);
            if (urlPattern !== undefined) {
              const method =
                staticString(objectProperty(config, "method"), sourceFile, constants)?.toUpperCase() ?? "GET";
              addOperation(node, method, urlPattern, axiosNames.has(memberCall.owner) ? "axios" : "client", 0.9, enclosingOperationName(node));
            }
          } else if (axiosNames.has(callee)) {
            const first = node.arguments[0];
            const config = asObject(first);
            const urlPattern =
              expressionToPattern(objectProperty(config, "url"), sourceFile, constants) ??
              expressionToPattern(first, sourceFile, constants);
            const options = config ?? asObject(node.arguments[1]);
            if (urlPattern !== undefined) {
              const method =
                staticString(objectProperty(options, "method"), sourceFile, constants)?.toUpperCase() ?? "GET";
              addOperation(node, method, urlPattern, "axios", 0.96, enclosingOperationName(node));
            }
          } else if (graphqlRequestNames.has(callee) || lowerCallee.endsWith(".request")) {
            const endpoint = expressionToPattern(node.arguments[0], sourceFile, constants);
            const info = graphqlInfoForExpression(node.arguments[1], sourceFile, gqlTagNames, graphqlDocuments);
            if (endpoint !== undefined && info !== undefined) {
              addOperation(node, info.method, endpoint, "graphql", 0.94, info.operationName ?? enclosingOperationName(node));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return dedupeOperations(results);
}

function collectImports(
  sourceFile: ts.SourceFile,
  axiosNames: Set<string>,
  graphqlRequestNames: Set<string>,
  gqlTagNames: Set<string>,
): void {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;

    if (moduleName === "axios") {
      if (clause.name !== undefined) axiosNames.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) axiosNames.add(bindings.name.text);
    }
    if (/graphql-request/.test(moduleName)) {
      if (clause.name !== undefined) graphqlRequestNames.add(clause.name.text);
      if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          const importedName = specifier.propertyName?.text ?? specifier.name.text;
          if (importedName === "request" || importedName === "rawRequest") graphqlRequestNames.add(specifier.name.text);
          if (importedName === "gql") gqlTagNames.add(specifier.name.text);
        }
      }
    }
    if (/(@apollo\/client|graphql-tag|urql|relay)/.test(moduleName)) {
      if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          const importedName = specifier.propertyName?.text ?? specifier.name.text;
          if (importedName === "gql" || importedName === "graphql") gqlTagNames.add(specifier.name.text);
        }
      }
      if (moduleName === "graphql-tag" && clause.name !== undefined) gqlTagNames.add(clause.name.text);
    }

    // A local module explicitly named api/client is commonly an Axios wrapper.
    if (/(^|\/)(api|http|rest)[-_/]?(client)?$|\/(api|http|rest)\/client/.test(moduleName)) {
      if (clause.name !== undefined) axiosNames.add(clause.name.text);
      if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          if (CLIENT_NAME_PATTERN.test(specifier.name.text)) axiosNames.add(specifier.name.text);
        }
      }
    }
  }
}

function collectAxiosInstances(sourceFile: ts.SourceFile, axiosNames: Set<string>): void {
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(unwrapExpression(node.initializer))
      ) {
        const call = unwrapExpression(node.initializer) as ts.CallExpression;
        const parts = memberCallParts(call.expression);
        if (parts?.method === "create" && axiosNames.has(parts.owner) && !axiosNames.has(node.name.text)) {
          axiosNames.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

function collectGraphqlDocuments(
  sourceFile: ts.SourceFile,
  gqlTagNames: Set<string>,
  documents: Map<string, GraphqlOperationInfo>,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isTaggedTemplateExpression(unwrapExpression(node.initializer))
    ) {
      const tagged = unwrapExpression(node.initializer) as ts.TaggedTemplateExpression;
      if (isGraphqlTag(tagged.tag, gqlTagNames)) {
        const info = parseGraphqlOperation(templateText(tagged.template));
        if (info !== undefined) documents.set(node.name.text, info);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function graphqlInfoForExpression(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  gqlTagNames: Set<string>,
  documents: ReadonlyMap<string, GraphqlOperationInfo>,
): GraphqlOperationInfo | undefined {
  if (expression === undefined) return undefined;
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return documents.get(value.text);
  if (ts.isTaggedTemplateExpression(value) && isGraphqlTag(value.tag, gqlTagNames)) {
    return parseGraphqlOperation(templateText(value.template));
  }
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return parseGraphqlOperation(value.text);
  }
  const text = value.getText(sourceFile);
  return parseGraphqlOperation(text);
}

function extractGraphqlFile(relativePath: string, sourceText: string, sourceModule: string): DiscoveredApiOperation[] {
  const operations: DiscoveredApiOperation[] = [];
  const matcher = /\b(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(stripGraphqlComments(sourceText))) !== null) {
    const keyword = match[1]?.toUpperCase() as GraphqlOperationInfo["method"];
    const operationName = match[2];
    if (operationName === undefined) continue;
    const prefix = sourceText.slice(0, match.index);
    const line = prefix.split("\n").length;
    const source = { filePath: relativePath, line, column: 1 };
    operations.push({
      id: stableId("api-source", keyword, "/graphql", operationName, relativePath, line),
      method: keyword,
      urlPattern: "/graphql",
      operationName,
      source,
      transport: "graphql",
      moduleName: inferApiModule("/graphql", sourceModule),
      confidence: 0.95,
    });
  }
  return operations;
}

function parseGraphqlOperation(documentText: string): GraphqlOperationInfo | undefined {
  const stripped = stripGraphqlComments(documentText).trim();
  const match = /^(?:\s*fragment\b[\s\S]*?\}\s*)*\b(query|mutation|subscription)\b(?:\s+([_A-Za-z][_0-9A-Za-z]*))?/i.exec(stripped);
  if (match === null) return undefined;
  const method = match[1]?.toUpperCase() as GraphqlOperationInfo["method"];
  const result: GraphqlOperationInfo = { method };
  if (match[2] !== undefined) result.operationName = match[2];
  return result;
}

function memberCallParts(expression: ts.Expression): { owner: string; method: string } | undefined {
  const value = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(value)) return undefined;
  return { owner: callName(value.expression), method: value.name.text };
}

function isHttpClient(owner: string, axiosNames: ReadonlySet<string>): boolean {
  return axiosNames.has(owner) || CLIENT_NAME_PATTERN.test(owner);
}

function asObject(expression: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  if (expression === undefined) return undefined;
  const value = unwrapExpression(expression);
  return ts.isObjectLiteralExpression(value) ? value : undefined;
}

function isGraphqlTag(tag: ts.LeftHandSideExpression, gqlTagNames: ReadonlySet<string>): boolean {
  const name = callName(tag);
  return gqlTagNames.has(name) || gqlTagNames.has(name.split(".").at(-1) ?? "");
}

function templateText(template: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  let result = template.head.text;
  for (const span of template.templateSpans) result += " " + span.literal.text;
  return result;
}

function enclosingVariableName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return undefined;
}

function normalizeUrlPattern(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function stripGraphqlComments(value: string): string {
  return value.replace(/#[^\n\r]*/g, "");
}

function dedupeOperations(operations: DiscoveredApiOperation[]): DiscoveredApiOperation[] {
  const seen = new Map<string, DiscoveredApiOperation>();
  for (const operation of operations) {
    const key = [
      operation.method,
      operation.urlPattern,
      operation.operationName ?? "",
      operation.source.filePath,
      operation.source.line ?? 0,
      operation.source.column ?? 0,
    ].join(":");
    const existing = seen.get(key);
    if (existing === undefined || operation.confidence > existing.confidence) seen.set(key, operation);
  }
  return [...seen.values()].sort(
    (left, right) =>
      left.urlPattern.localeCompare(right.urlPattern) ||
      left.method.localeCompare(right.method) ||
      left.source.filePath.localeCompare(right.source.filePath),
  );
}
