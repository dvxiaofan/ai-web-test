import type { JsonObject } from '../core/types.js';
import type { AuthOutcome, AuthStrategy, ResolvedCredentials, RoleAuthConfig } from './types.js';
import { detectAuthStrategy } from './detector.js';
import { blocked } from './outcome.js';
import {
  authenticateWithUi,
  type BrowserAuthSurface,
  type PostLoginStep,
  type UiAuthOptions,
} from './ui-adapter.js';
import { authenticateWithApi, type TokenClient } from './api-adapter.js';
import { authenticateWithCustom, type ScriptRunner } from './custom-adapter.js';
import { authenticateWithStorageState } from './storage-state-adapter.js';

export type {
  AuthStrategy,
  AuthBlockedCode,
  AuthBlockedReason,
  CredentialReference,
  AuthTarget,
  RoleAuthConfig,
  ResolvedCredentials,
  StorageState,
  StorageStateCookie,
  StorageStateOrigin,
  AuthOutcome,
  AuthSuccess,
  AuthBlocked,
} from './types.js';
export { detectAuthStrategy, isSupportedStrategy } from './detector.js';
export {
  storageStateIsValid,
  loadStorageState,
  saveStorageState,
  redactStorageState,
} from './storage-state.js';
export type { BrowserAuthSurface, UiAuthOptions } from './ui-adapter.js';
export type { TokenClient } from './api-adapter.js';
export type { ScriptRunner } from './custom-adapter.js';

export interface AuthDeps {
  /** Resolve an environment variable reference to its concrete value. */
  env: (name: string) => string | undefined;
  surface?: BrowserAuthSurface;
  tokenClient?: TokenClient;
  runner?: ScriptRunner;
  /** Build UI adapter options (selectors, urls) for a role. */
  uiOptions?: (config: RoleAuthConfig) => UiAuthOptions;
}

export function resolveCredentials(
  config: RoleAuthConfig,
  env: (name: string) => string | undefined,
): ResolvedCredentials {
  const creds = config.credentials ?? {};
  const extra: Record<string, string> = {};
  for (const name of creds.extraEnv ?? []) {
    const value = env(name);
    if (value !== undefined) extra[name] = value;
  }
  return {
    username: creds.usernameEnv ? env(creds.usernameEnv) : undefined,
    password: creds.passwordEnv ? env(creds.passwordEnv) : undefined,
    token: creds.tokenEnv ? env(creds.tokenEnv) : undefined,
    apiKey: creds.apiKeyEnv ? env(creds.apiKeyEnv) : undefined,
    extra,
  };
}

function defaultUiOptions(target: RoleAuthConfig['target'], config: RoleAuthConfig): UiAuthOptions {
  const meta = (config.metadata ?? {}) as JsonObject;
  const selector = (key: string, fallback: string): string =>
    typeof meta[key] === 'string' ? (meta[key] as string) : fallback;
  const optional = (key: string): string | undefined =>
    typeof meta[key] === 'string' ? (meta[key] as string) : undefined;
  const postLoginSteps = Array.isArray(meta['postLoginSteps'])
    ? (meta['postLoginSteps'] as unknown as PostLoginStep[])
    : undefined;
  return {
    loginUrl: target?.loginUrl ?? target?.baseUrl ?? '',
    usernameSelector: selector('usernameSelector', 'input[name="username"]'),
    passwordSelector: selector('passwordSelector', 'input[name="password"]'),
    submitSelector: selector('submitSelector', 'button[type="submit"]'),
    successIndicatorSelector: optional('successIndicatorSelector'),
    errorIndicatorSelector: optional('errorIndicatorSelector'),
    ...(postLoginSteps ? { postLoginSteps } : {}),
  };
}

/**
 * Resolve credentials, detect the concrete strategy, and dispatch to the
 * matching adapter. Adapters receive injected surfaces/clients so this function
 * is deterministic and testable without a browser or network.
 */
export async function authenticate(config: RoleAuthConfig, deps: AuthDeps): Promise<AuthOutcome> {
  const strategy = detectAuthStrategy(config);
  const target = config.target ?? { baseUrl: '' };
  const resolved = resolveCredentials(config, deps.env);
  const roleId = config.id;

  switch (strategy) {
    case 'storage-state': {
      if (!target.storageStatePath) {
        return blocked(roleId, strategy, 'storage-state-invalid', 'storage-state strategy but no storageStatePath configured.', false);
      }
      return authenticateWithStorageState(target.storageStatePath, roleId, strategy);
    }
    case 'custom': {
      if (!target.scriptPath) {
        return blocked(roleId, strategy, 'custom-script-failed', 'custom strategy but no scriptPath configured.', false);
      }
      if (!deps.runner) {
        return blocked(roleId, strategy, 'custom-script-failed', 'No script runner available.', false);
      }
      return authenticateWithCustom(
        deps.runner,
        { roleId, strategy, extraEnv: resolved.extra },
        target.scriptPath,
      );
    }
    case 'api': {
      if (!deps.tokenClient) {
        return blocked(roleId, strategy, 'unsupported-strategy', 'No token client available for api strategy.', false);
      }
      const tokenUrl = target.tokenUrl ?? '';
      const body: Record<string, string> = { ...resolved.extra };
      if (resolved.username) body.username = resolved.username;
      if (resolved.password) body.password = resolved.password;
      if (resolved.token) body.token = resolved.token;
      if (resolved.apiKey) body.apiKey = resolved.apiKey;
      return authenticateWithApi(
        deps.tokenClient,
        { roleId, strategy, token: resolved.token, apiKey: resolved.apiKey },
        { tokenUrl, body, headers: target.headers },
      );
    }
    case 'ui':
    case 'sso-assisted': {
      if (!deps.surface) {
        return blocked(roleId, strategy, 'unsupported-strategy', 'No browser surface available for ui strategy.', false);
      }
      const options = deps.uiOptions?.(config) ?? defaultUiOptions(target, config);
      return authenticateWithUi(
        deps.surface,
        { roleId, strategy, username: resolved.username, password: resolved.password },
        options,
      );
    }
    default:
      return blocked(roleId, strategy as AuthStrategy, 'unsupported-strategy', `Unsupported strategy: ${strategy}`, false);
  }
}
