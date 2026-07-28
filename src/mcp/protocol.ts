import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Phase 5C — MCP protocol surface.
 *
 * The Model Context Protocol (MCP) server exposes the same core capabilities
 * the CLI uses (`discover` → `plan` → `approve` → `run` → `report`) behind a
 * JSON-RPC surface so an AI client can drive the whole workflow. Every tool
 * reuses the core modules, never duplicates their logic, so the artifacts an
 * AI produces through MCP are identical to what the CLI would produce.
 */

/** Server identity reported during `initialize`. */
export const MCP_SERVER_NAME = 'ai-web-test';
export const MCP_SERVER_VERSION = '0.1.0';

/**
 * Stable tool names. The `awt_` prefix namespaces our tools so they don't
 * collide with tools from other servers an AI client may have connected.
 */
export const MCP_TOOLS = {
  status: 'awt_status',
  discover: 'awt_discover',
  inventoryQuery: 'awt_inventory_query',
  plan: 'awt_plan',
  approve: 'awt_approve',
  run: 'awt_run',
  report: 'awt_report',
  business: 'awt_business',
  scenariosGenerate: 'awt_scenarios_generate',
  healingClassify: 'awt_healing_classify',
  healingReview: 'awt_healing_review',
  healingTrends: 'awt_healing_trends',
  healingRetention: 'awt_healing_retention',
  projectReport: 'awt_project_report',
} as const;

export type McpToolName = (typeof MCP_TOOLS)[keyof typeof MCP_TOOLS];

/** Wrap a plain value as a successful MCP tool result (pretty JSON text). */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** Wrap an error as a failed MCP tool result. Keeps the JSON-RPC exchange valid. */
export function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/** Runtime options used to boot the server from the CLI. */
export interface McpRuntimeOptions {
  configPath: string;
  transport?: 'stdio';
}
