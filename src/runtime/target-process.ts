import { appendFile, mkdir } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export interface TargetProcessOptions {
  baseUrl?: string;
  startCommand?: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  outputDir: string;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  noStart?: boolean;
}

export interface TargetProcessHandle {
  started: boolean;
  reusedExisting: boolean;
  command?: string;
  logPath?: string;
  close: () => Promise<void>;
}

/**
 * Start a configured local target only when its base URL is not already
 * reachable. The command is an operator-owned configuration value; no target
 * source file is modified and the child is always terminated on close.
 */
export async function withTargetProcess<T>(
  options: TargetProcessOptions,
  callback: (handle: TargetProcessHandle) => Promise<T>,
): Promise<T> {
  const handle = await startTargetProcess(options);
  try {
    return await callback(handle);
  } finally {
    await handle.close();
  }
}

export async function startTargetProcess(options: TargetProcessOptions): Promise<TargetProcessHandle> {
  if (options.noStart || !options.baseUrl || !options.startCommand) {
    return { started: false, reusedExisting: false, close: async () => undefined };
  }
  if (await isReachable(options.baseUrl, 2_000)) {
    return { started: false, reusedExisting: true, close: async () => undefined };
  }

  await mkdir(options.outputDir, { recursive: true });
  const logPath = path.join(options.outputDir, 'target-process.log');
  const log = (chunk: Buffer | string) => {
    void appendFile(logPath, redactLog(String(chunk))).catch(() => undefined);
  };
  const child = spawn(options.startCommand, {
    cwd: options.workingDirectory,
    env: { ...process.env, ...(options.environment ?? {}) },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout?.on('data', log);
  child.stderr?.on('data', log);

  try {
    await waitForReachable(options.baseUrl, child, options.waitTimeoutMs ?? 60_000, options.pollIntervalMs ?? 500);
  } catch (error) {
    await terminateChild(child);
    throw new Error(`Target did not become reachable at ${options.baseUrl}: ${error instanceof Error ? error.message : String(error)}. See ${logPath}.`);
  }

  return {
    started: true,
    reusedExisting: false,
    command: options.startCommand,
    logPath,
    close: () => terminateChild(child),
  };
}

function redactLog(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|passwd|token|secret|api[-_]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
}

async function waitForReachable(url: string, child: ChildProcess, timeoutMs: number, pollMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`target process exited with code ${child.exitCode}`);
    try {
      if (await isReachable(url, Math.min(2_000, pollMs * 4))) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError);
}

async function isReachable(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  signalProcessTree(child, 'SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) signalProcessTree(child, 'SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when the process group is already gone.
    }
  }
  child.kill(signal);
}
