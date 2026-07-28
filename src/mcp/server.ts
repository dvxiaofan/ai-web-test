import type { Readable, Writable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpService } from './service.js';
import { registerMcpTools } from './tools.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './protocol.js';

/** Build a configured MCP server with every `awt_*` tool registered. */
export function createMcpServer(service: McpService): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerMcpTools(server, service);
  return server;
}

export interface StartMcpServerOptions {
  configPath: string;
  /** Inject custom streams (used by tests). Defaults to process.stdin/stdout. */
  stdin?: Readable;
  stdout?: Writable;
}

/**
 * Boot the MCP server over stdio and keep the process alive until the transport
 * closes (client disconnect / stdin EOF). Intended to be launched via the
 * `aitest mcp` CLI subcommand.
 */
export async function startMcpServer(options: StartMcpServerOptions): Promise<void> {
  const service = new McpService({ configPath: options.configPath });
  const server = createMcpServer(service);
  const transport = new StdioServerTransport(options.stdin, options.stdout);
  await server.connect(transport);

  // Sit idle until the client closes the connection, preserving the server's
  // own close handler so it can clean up its internal state.
  const previousClose = transport.onclose;
  await new Promise<void>((resolve) => {
    transport.onclose = () => {
      previousClose?.();
      resolve();
    };
  });
}
