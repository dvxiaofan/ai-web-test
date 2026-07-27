import type { AuthStrategy, StorageState } from './types.js';
import { storageStateIsValid } from './storage-state.js';
import { blocked, success } from './outcome.js';

/** Injectable runner so the custom adapter is testable without spawning processes. */
export interface ScriptRunner {
  run(
    scriptPath: string,
    env: Record<string, string>,
  ): Promise<{ ok: boolean; storageState?: StorageState; message?: string }>;
}

export interface CustomAuthContext {
  roleId: string;
  strategy: AuthStrategy;
  extraEnv: Record<string, string>;
}

export async function authenticateWithCustom(
  runner: ScriptRunner,
  ctx: CustomAuthContext,
  scriptPath: string,
) {
  const result = await runner.run(scriptPath, ctx.extraEnv);
  if (!result.ok || !result.storageState) {
    return blocked(
      ctx.roleId,
      ctx.strategy,
      'custom-script-failed',
      result.message ?? 'Custom auth script failed.',
      false,
    );
  }
  if (!storageStateIsValid(result.storageState)) {
    return blocked(
      ctx.roleId,
      ctx.strategy,
      'custom-script-failed',
      'Custom auth script returned an invalid storage state.',
      false,
    );
  }
  return success(ctx.roleId, ctx.strategy, result.storageState);
}
