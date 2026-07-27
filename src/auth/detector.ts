import type { AuthStrategy, RoleAuthConfig } from './types.js';

/**
 * Phase 2 — strategy detection.
 *
 * When a role requests `auto`, infer the concrete strategy from the config it
 * provides. Explicit strategies are always honored.
 */
export function detectAuthStrategy(
  role: Pick<RoleAuthConfig, 'strategy' | 'credentials' | 'target'>,
): AuthStrategy {
  if (role.strategy !== 'auto') return role.strategy;

  if (role.target?.storageStatePath) return 'storage-state';
  if (role.target?.scriptPath) return 'custom';
  if (role.target?.tokenUrl) return 'api';
  if (role.credentials?.tokenEnv || role.credentials?.apiKeyEnv) return 'api';
  if (role.credentials?.usernameEnv && role.credentials?.passwordEnv) return 'ui';

  // Default to the interactive form flow; it can fall back to sso-assisted when
  // an SSO/MFA wall is detected at runtime.
  return 'ui';
}

export function isSupportedStrategy(strategy: string): strategy is AuthStrategy {
  return (
    strategy === 'auto' ||
    strategy === 'ui' ||
    strategy === 'api' ||
    strategy === 'storage-state' ||
    strategy === 'sso-assisted' ||
    strategy === 'custom'
  );
}
