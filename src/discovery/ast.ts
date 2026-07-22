import path from "node:path";

import ts from "typescript";

import type { SourceLocation } from "../core/types.js";

export interface ParsedSource {
  sourceFile: ts.SourceFile;
  lineOffset: number;
}

export function parseSourceText(relativePath: string, text: string): ParsedSource[] {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".graphql" || extension === ".gql") return [];

  if (extension === ".vue") {
    const blocks: ParsedSource[] = [];
    const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptPattern.exec(text)) !== null) {
      const scriptText = match[1] ?? "";
      const bodyStart = match.index + match[0].indexOf(scriptText);
      const lineOffset = countLines(text.slice(0, bodyStart)) - 1;
      blocks.push({
        sourceFile: ts.createSourceFile(
          `${relativePath}#script-${blocks.length + 1}.ts`,
          scriptText,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
        lineOffset,
      });
    }
    return blocks;
  }

  const scriptKind = scriptKindFor(extension);
  return [
    {
      sourceFile: ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, scriptKind),
      lineOffset: 0,
    },
  ];
}

export function sourceLocation(
  relativePath: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  lineOffset = 0,
): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    filePath: relativePath,
    line: start.line + 1 + lineOffset,
    column: start.character + 1,
    endLine: end.line + 1 + lineOffset,
    endColumn: end.character + 1,
  };
}

export function collectStaticConstants(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const constants = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
        constants.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return constants;
}

export function expressionToPattern(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
): string | undefined {
  if (expression === undefined) return undefined;
  const unwrapped = unwrapExpression(expression);

  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text;
  if (ts.isNumericLiteral(unwrapped)) return unwrapped.text;
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return "false";

  if (ts.isIdentifier(unwrapped)) {
    if (seen.has(unwrapped.text)) return dynamicSegment(unwrapped.text);
    const value = constants.get(unwrapped.text);
    if (value !== undefined) {
      const nextSeen = new Set(seen);
      nextSeen.add(unwrapped.text);
      return expressionToPattern(value, sourceFile, constants, nextSeen);
    }
    return dynamicSegment(unwrapped.text);
  }

  if (ts.isTemplateExpression(unwrapped)) {
    let result = unwrapped.head.text;
    for (const span of unwrapped.templateSpans) {
      const value = expressionToPattern(span.expression, sourceFile, constants, seen);
      result += value === undefined ? dynamicSegment(span.expression.getText(sourceFile)) : ensureDynamic(value, span.expression);
      result += span.literal.text;
    }
    return result;
  }

  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionToPattern(unwrapped.left, sourceFile, constants, seen);
    const right = expressionToPattern(unwrapped.right, sourceFile, constants, seen);
    if (left === undefined || right === undefined) return undefined;
    return left + right;
  }

  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return dynamicSegment(compactExpression(unwrapped.getText(sourceFile)));
  }

  if (ts.isCallExpression(unwrapped)) {
    const callee = callName(unwrapped.expression);
    if ((callee === "String" || callee === "encodeURIComponent") && unwrapped.arguments[0] !== undefined) {
      const inner = expressionToPattern(unwrapped.arguments[0], sourceFile, constants, seen);
      return inner === undefined ? undefined : ensureDynamic(inner, unwrapped.arguments[0]);
    }
  }

  return undefined;
}

export function staticString(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
): string | undefined {
  const value = expressionToPattern(expression, sourceFile, constants);
  return value?.includes("${") ? undefined : value;
}

export function staticBoolean(expression: ts.Expression | undefined): boolean | undefined {
  if (expression === undefined) return undefined;
  const value = unwrapExpression(expression);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

export function propertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

export function objectProperty(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  if (object === undefined) return undefined;
  for (const property of object.properties) {
    if (propertyName(property.name)?.toLowerCase() !== name.toLowerCase()) continue;
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
  }
  return undefined;
}

export function expressionStrings(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
): string[] {
  if (expression === undefined) return [];
  const value = unwrapExpression(expression);
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.flatMap((element) =>
      ts.isExpression(element) ? expressionStrings(element, sourceFile, constants) : [],
    );
  }
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) return [];
      const key = propertyName(property.name)?.toLowerCase();
      return key === "role" || key === "roles" || key === "permission" || key === "permissions"
        ? expressionStrings(property.initializer, sourceFile, constants)
        : [];
    });
  }
  const result = staticString(value, sourceFile, constants);
  return result === undefined ? [] : [result];
}

export function callName(expression: ts.Expression): string {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value)) return `${callName(value.expression)}.${value.name.text}`;
  if (ts.isElementAccessExpression(value) && value.argumentExpression !== undefined) {
    return `${callName(value.expression)}.${value.argumentExpression.getText()}`;
  }
  return value.getText();
}

export function enclosingOperationName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name !== undefined
    ) {
      return current.name.getText();
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return undefined;
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function ensureDynamic(value: string, original: ts.Expression): string {
  if (value.startsWith("${") && value.endsWith("}")) return value;
  if (ts.isStringLiteralLike(unwrapExpression(original))) return value;
  return dynamicSegment(value);
}

function dynamicSegment(value: string): string {
  return `\${${compactExpression(value)}}`;
}

function compactExpression(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function scriptKindFor(extension: string): ts.ScriptKind {
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function countLines(value: string): number {
  let count = 1;
  for (const character of value) if (character === "\n") count += 1;
  return count;
}
