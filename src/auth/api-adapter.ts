import type { AuthStrategy, StorageState, StorageStateCookie } from './types.js';
import { blocked, success } from './outcome.js';

/** Injectable HTTP surface so the API adapter is unit-testable without network. */
export interface TokenClient {
  exchange(input: {
    url: string;
    body: Record<string, string>;
    headers?: Record<string, string> | undefined;
  }): Promise<{ status: number; body: Record<string, unknown>; cookies: StorageStateCookie[] }>;
}

export interface ApiAuthOptions {
  tokenUrl: string;
  body: Record<string, string>;
  headers?: Record<string, string> | undefined;
}

export interface ApiAuthContext {
  roleId: string;
  strategy: AuthStrategy;
  token?: string | undefined;
  apiKey?: string | undefined;
}

export async function authenticateWithApi(
  client: TokenClient,
  ctx: ApiAuthContext,
  options: ApiAuthOptions,
) {
  if (!ctx.token && !ctx.apiKey && !(options.body.username && options.body.password)) {
    return blocked(ctx.roleId, ctx.strategy, 'credentials-missing', 'No token, api key, or credentials supplied.', false);
  }

  const res = await client.exchange({ url: options.tokenUrl, body: options.body, headers: options.headers });
  if (res.status < 200 || res.status >= 300) {
    return blocked(
      ctx.roleId,
      ctx.strategy,
      'login-failed',
      `Token endpoint returned HTTP ${res.status}.`,
      false,
    );
  }

  const storageState: StorageState = { cookies: res.cookies, origins: [] };
  const warnings = res.cookies.length === 0 ? ['Token endpoint succeeded but set no cookies.'] : [];
  return success(ctx.roleId, ctx.strategy, storageState, warnings);
}
