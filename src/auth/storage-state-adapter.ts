import type { AuthStrategy } from './types.js';
import { loadStorageState } from './storage-state.js';
import { blocked, success } from './outcome.js';

export async function authenticateWithStorageState(
  filePath: string,
  role: string,
  strategy: AuthStrategy,
) {
  try {
    const state = await loadStorageState(filePath);
    return success(role, strategy, state);
  } catch (error) {
    return blocked(role, strategy, 'storage-state-invalid', (error as Error).message, false);
  }
}
