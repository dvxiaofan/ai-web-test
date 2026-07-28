import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { PassThrough, type Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpService } from '../../src/mcp/index.js';
import { createMcpServer } from '../../src/mcp/index.js';

/**
 * Minimal in-process MCP client over memory streams. The server's stdio
 * transport reads newline-delimited JSON from `input` and writes to `output`;
 * this client drives the JSON-RPC lifecycle without spawning a subprocess.
 */
class McpTestClient {
  private readonly input = new PassThrough();
  private readonly output = new PassThrough();
  private readonly pending = new Map<number, (message: any) => void>();
  private buffer = '';
  private seq = 0;
  readonly server: McpServer;
  private readonly transport: StdioServerTransport;

  constructor(service: McpService) {
    this.server = createMcpServer(service);
    this.transport = new StdioServerTransport(this.input as unknown as Readable, this.output);
    this.output.on('data', (chunk: Buffer) => this.onData(chunk));
  }

  async start(): Promise<void> {
    await this.server.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)!(message);
        this.pending.delete(message.id);
      }
    }
  }

  request(method: string, params: unknown, id?: number): Promise<any> {
    const requestId = id ?? ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      this.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown): void {
    this.input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
}

describe('MCP server over stdio (in-memory)', () => {
  let configPath: string;
  let tmpDir: string;
  let client: McpTestClient;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-srv-'));
    const raw = JSON.parse(await readFile(path.resolve('examples/sample.config.json'), 'utf8'));
    raw.artifacts.directory = path.join(tmpDir, '.artifacts');
    configPath = path.join(tmpDir, 'ai-web-test.config.json');
    await writeFile(configPath, JSON.stringify(raw, null, 2));

    const service = new McpService({ configPath });
    client = new McpTestClient(service);
    await client.start();
  });

  afterAll(async () => {
    await client?.close();
    await import('node:fs/promises').then((fs) => fs.rm(tmpDir, { recursive: true, force: true }));
  });

  it('completes the initialize handshake', async () => {
    const response = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    expect(response.result).toBeDefined();
    expect(response.result.serverInfo.name).toBe('ai-web-test');
    client.notify('notifications/initialized', {});
  });

  it('lists all awt_* tools', async () => {
    const response = await client.request('tools/list', {});
    const names = response.result.tools.map((tool: any) => tool.name);
    expect(names).toHaveLength(13);
    expect(names.every((name: string) => name.startsWith('awt_'))).toBe(true);
    expect(names).toContain('awt_healing_classify');
    expect(names).toContain('awt_healing_review');
    expect(names).toContain('awt_healing_trends');
    expect(names).toContain('awt_healing_retention');
  });

  it('calls awt_status and returns a JSON status object', async () => {
    const response = await client.request('tools/call', {
      name: 'awt_status',
      arguments: {},
    });
    const payloadRaw = response.result.content?.[0]?.text ?? '';
    expect(response.result.isError, `awt_status failed: ${payloadRaw}`).not.toBe(true);
    const payload = JSON.parse(payloadRaw);
    expect(payload.configPath).toBe(configPath);
    expect(typeof payload.ready).toBe('boolean');
  });
});
