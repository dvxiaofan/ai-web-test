import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpService } from './service.js';
import { MCP_TOOLS, errorResult, jsonResult } from './protocol.js';
import type { TestScenario } from '../core/types.js';

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

  server.registerTool(
    MCP_TOOLS.healingClassify,
    {
      description: 'Classify the failures of a run into deterministic categories with evidence (Phase 6 healing).',
      inputSchema: {
        runId: z.string().describe('Run id to triage (required).'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.healingClassify({ runId: args.runId as string }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.healingReview,
    {
      description:
        'Review a proposed fix (before -> after scenario) for a failing scenario; runs semantic diff + whitelist policy and returns an auditable proposal.',
      inputSchema: {
        runId: z.string().describe('Run id the failure belongs to (required).'),
        before: z.object({}).passthrough().describe('Failing scenario before the proposed fix.'),
        after: z.object({}).passthrough().describe('Proposed fixed scenario.'),
        changeNote: z.string().optional().describe('Optional human note about the change.'),
      },
    },
    async (args) => {
      try {
        const params: {
          runId: string;
          before: TestScenario;
          after: TestScenario;
          changeNote?: string;
        } = {
          runId: args.runId as string,
          before: args.before as unknown as TestScenario,
          after: args.after as unknown as TestScenario,
        };
        if (typeof args.changeNote === 'string') params.changeNote = args.changeNote;
        return jsonResult(await service.healingReview(params));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.healingTrends,
    {
      description: 'Build the historical trend report (pass rate / coverage / failure mix / flaky scenarios).',
      inputSchema: {
        flakyWindow: z.number().optional().describe('Window (ms) for flaky detection; defaults to 7 days.'),
      },
    },
    async (args) => {
      try {
        const params: { flakyWindow?: number } = {};
        if (typeof args.flakyWindow === 'number') params.flakyWindow = args.flakyWindow;
        return jsonResult(await service.healingTrends(params));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    MCP_TOOLS.healingRetention,
    {
      description: 'Apply the artifact retention policy to the store (supports dry-run).',
      inputSchema: {
        maxRuns: z.number().optional().describe('Keep at most this many newest runs.'),
        maxAgeDays: z.number().optional().describe('Remove runs older than this many days.'),
        pinnedRunIds: z.array(z.string()).optional().describe('Run ids that must never be removed.'),
        dryRun: z.boolean().optional().describe('Report removals without deleting.'),
      },
    },
    async (args) => {
      try {
        const params: {
          maxRuns?: number;
          maxAgeDays?: number;
          pinnedRunIds?: string[];
          dryRun?: boolean;
        } = {};
        if (typeof args.maxRuns === 'number') params.maxRuns = args.maxRuns;
        if (typeof args.maxAgeDays === 'number') params.maxAgeDays = args.maxAgeDays;
        if (Array.isArray(args.pinnedRunIds)) params.pinnedRunIds = args.pinnedRunIds;
        if (typeof args.dryRun === 'boolean') params.dryRun = args.dryRun;
        return jsonResult(await service.healingRetention(params));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
