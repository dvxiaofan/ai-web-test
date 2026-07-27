import type { JsonObject } from '../core/types.js';
import type { AuthBlocked, AuthBlockedCode, AuthOutcome, AuthStrategy, StorageState } from './types.js';

export function blocked(
  role: string,
  strategy: AuthStrategy,
  code: AuthBlockedCode,
  message: string,
  retryable: boolean,
  details?: JsonObject,
): AuthBlocked {
  return {
    ok: false,
    role,
    strategy,
    reason: {
      code,
      message,
      retryable,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

export function success(
  role: string,
  strategy: AuthStrategy,
  storageState: StorageState,
  warnings: string[] = [],
): AuthOutcome {
  return { ok: true, role, strategy, storageState, warnings };
}
