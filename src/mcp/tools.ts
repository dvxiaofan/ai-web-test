import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpService } from './service.js';
import { MCP_TOOLS, errorResult, jsonResult } from './protocol.js';

/**
 * Register every `awt_*` tool onto an MCP server. Each handler delegates to the
 * shared McpService (which reuses the core modules) and normalizes the outcome
 * into a JSON-RPC tool result: structured data on success, a single error line
 * (isError: true) on failure.
 */
export function registerMcpTools(server: McpServer, service: McpService): void {
  server.registerTool(
    MCP_TOOLS.status,
    {
      description:
        'Show the resolved config, artifact directory, and whether an inventory has been discovered yet.',
    },
    async () => {
      try {
        return jsonResult(await service.status());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.discover,
    {
      description:
        'Run inventory discovery. Static-only by default (no browser). Pass staticOnly=false to also explore the running target (with start=true to launch it).',
      inputSchema: {
        staticOnly: z.boolean().optional().describe('Skip runtime browser exploration (default true).'),
        start: z.boolean().optional().describe('Start the target server before runtime exploration.'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.discover(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.inventoryQuery,
    {
      description:
        'Query the discovered inventory: summary, modules, a single module, pages, relationships, coverage gaps, or business coverage.',
      inputSchema: {
        action: z
          .enum(['summary', 'modules', 'module', 'page', 'relationships', 'gaps', 'business'])
          .describe('What slice of the inventory to return.'),
        id: z.string().optional().describe('Node id, required for the `module`/`page` actions.'),
        includeScenarios: z
          .boolean()
          .optional()
          .describe('Include scenario coverage counts in the result.'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.inventoryQuery(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.plan,
    {
      description:
        'Propose a test plan from the inventory and scenarios, and persist it as `proposed-<id>.json`.',
      inputSchema: {
        scope: z
          .enum(['full', 'module', 'route', 'scenario', 'tag', 'role', 'affected', 'failed', 'smoke'])
          .optional(),
        moduleIds: z.array(z.string()).optional().describe('Module ids or names to include.'),
        routeIds: z.array(z.string()).optional().describe('Route ids or paths to include.'),
        scenarioIds: z.array(z.string()).optional().describe('Scenario ids or names to include.'),
        tags: z.array(z.string()).optional().describe('Tags to include.'),
        roleIds: z.array(z.string()).optional().describe('Role ids or names to exercise.'),
        changedPaths: z.array(z.string()).optional().describe('Changed source paths (changed scope).'),
        failedRunId: z.string().optional().describe('Base the plan on a failed run (regression scope).'),
        includeDependencies: z.boolean().optional(),
        level: z.enum(['smoke', 'standard', 'regression', 'exploratory']).optional(),
        maxRisk: z.enum(['read', 'mutate', 'destructive']).optional(),
        browserProfileIds: z.array(z.string()).optional(),
        createdBy: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.plan(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.approve,
    {
      description:
        'Approve a proposed plan (defaults to the latest proposed) and persist it as `approved-<id>.json`.',
      inputSchema: {
        planId: z.string().optional().describe('Plan id to approve; defaults to the latest proposed.'),
        by: z.string().optional().describe('Approver identity.'),
        note: z.string().optional().describe('Approval note.'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.approve(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.run,
    {
      description:
        'Execute an approved plan against the target and write the run result + HTML/Markdown report. Requires a running target or start=true.',
      inputSchema: {
        planId: z.string().optional().describe('Plan id to run; defaults to the latest approved.'),
        start: z.boolean().optional().describe('Launch the target server before running.'),
        updateBaselines: z.boolean().optional().describe('Update visual baselines during the run.'),
        allowVisualDiff: z.boolean().optional().describe('Treat visual diffs as failures unless true.'),
        captureTrace: z.boolean().optional().describe('Capture Playwright traces.'),
        captureScreenshots: z.boolean().optional().describe('Capture screenshots on failure.'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.run(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.report,
    {
      description: 'Build the HTML/Markdown report for a completed run.',
      inputSchema: {
        runId: z.string().optional().describe('Run id; required.'),
        output: z.string().optional().describe('Override the HTML output path.'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.report(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.business,
    {
      description:
        'Build the business inventory and compute business coverage + gaps from the discovered inventory.',
    },
    async () => {
      try {
        return jsonResult(await service.business());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.scenariosGenerate,
    {
      description:
        'Generate route smoke scenarios from the inventory and merge them into the scenario catalog.',
    },
    async () => {
      try {
        return jsonResult(await service.scenariosGenerate());
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
