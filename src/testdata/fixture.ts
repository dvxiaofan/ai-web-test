import type { TestDataRecord, TestDataScope, ValidationResult } from "./types.js";

/**
 * Fixture 是测试数据的可版本化快照。这里只做解析与归一化，
 * 不触碰文件系统——调用方负责从磁盘/HTTP 读取原始内容。
 */
export type RawFixture = {
  name: string;
  kind: TestDataRecord["kind"];
  payload: Record<string, unknown>;
  ttlSeconds?: number;
  cleanup?: TestDataRecord["cleanup"];
}[];

export interface CompileFixtureInput {
  scope?: TestDataScope;
  namespaceId: string;
  raw: RawFixture;
}

let counter = 0;
function autoId(namespaceId: string): string {
  counter += 1;
  return `${namespaceId}:rec:${counter}`;
}

/** 将原始 fixture 归一化为带 id 的 TestDataRecord 列表。 */
export function compileFixture(input: CompileFixtureInput): TestDataRecord[] {
  return input.raw.map((r, idx) => ({
    id: `${input.namespaceId}:${slug(r.name) || `r${idx}`}`,
    kind: r.kind,
    name: r.name,
    payload: r.payload,
    ...(r.ttlSeconds !== undefined ? { ttlSeconds: r.ttlSeconds } : {}),
    ...(r.cleanup !== undefined ? { cleanup: r.cleanup } : {}),
  }));
}

/** 校验原始 fixture 结构。 */
export function validateFixture(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    errors.push("fixture 必须是数组");
    return { valid: false, errors };
  }
  raw.forEach((item, idx) => {
    if (typeof item !== "object" || item === null) {
      errors.push(`fixture[${idx}] 不是对象`);
      return;
    }
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.trim().length === 0) errors.push(`fixture[${idx}].name 非法`);
    if (!["entity", "row", "file", "state"].includes(r.kind as string)) errors.push(`fixture[${idx}].kind 非法`);
    if (typeof r.payload !== "object" || r.payload === null) errors.push(`fixture[${idx}].payload 非法`);
  });
  return { valid: errors.length === 0, errors };
}

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
