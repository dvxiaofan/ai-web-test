/**
 * Phase 2 — authentication types.
 *
 * Secrets are never embedded. Every credential is a reference to an environment
 * variable that is resolved at runtime. Adapters never receive raw passwords or
 * tokens; they receive a resolved map produced from those references.
 */
import type { JsonObject } from '../core/types.js';

export type AuthStrategy =
  | 'auto'
  | 'ui'
  | 'api'
  | 'storage-state'
  | 'sso-assisted'
  | 'custom';

export type AuthBlockedCode =
  | 'sso-mfa-required'
  | 'captcha-required'
  | 'credentials-missing'
  | 'login-failed'
  | 'unsupported-strategy'
  | 'storage-state-invalid'
  | 'custom-script-failed';

export interface AuthBlockedReason {
  code: AuthBlockedCode;
  message: string;
  retryable: boolean;
  details?: JsonObject;
}

export interface CredentialReference {
  usernameEnv?: string;
  passwordEnv?: string;
  tokenEnv?: string;
  apiKeyEnv?: string;
  /** Extra environment variable names the auth flow may read at runtime. */
  extraEnv?: string[];
}

export interface AuthTarget {
  baseUrl: string;
  loginUrl?: string;
  /** Endpoint used by the api strategy to exchange credentials for a session. */
  tokenUrl?: string;
  /** Custom script path used by the custom strategy. */
  scriptPath?: string;
  /** Read-only storage state path used by the storage-state strategy. */
  storageStatePath?: string;
  headers?: Record<string, string>;
}

export interface RoleAuthConfig {
  id: string;
  name: string;
  strategy: AuthStrategy;
  credentials?: CredentialReference;
  target?: AuthTarget;
  /** Roll the session before this age to avoid stale storage state. */
  sessionMaxAgeMs?: number;
  metadata?: JsonObject;
}

export interface ResolvedCredentials {
  username?: string | undefined;
  password?: string | undefined;
  token?: string | undefined;
  apiKey?: string | undefined;
  extra: Record<string, string>;
}

export interface StorageStateCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface StorageStateOrigin {
  origin: string;
  localStorage: { name: string; value: string }[];
}

export interface StorageState {
  cookies: StorageStateCookie[];
  origins: StorageStateOrigin[];
}

export interface AuthSuccess {
  ok: true;
  role: string;
  strategy: AuthStrategy;
  storageState: StorageState;
  warnings: string[];
}

export interface AuthBlocked {
  ok: false;
  role: string;
  strategy: AuthStrategy;
  reason: AuthBlockedReason;
}

export type AuthOutcome = AuthSuccess | AuthBlocked;
