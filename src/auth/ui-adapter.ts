import type { AuthStrategy, StorageState } from './types.js';
import { blocked, success } from './outcome.js';

/**
 * Minimal browser surface the UI adapter drives. Real Playwright wiring is
 * supplied by the CLI; tests provide a fake implementation.
 */
export interface BrowserAuthSurface {
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  getUrl(): Promise<string>;
  getText(selector: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  captureStorageState(): Promise<StorageState>;
}

export interface UiAuthOptions {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successIndicatorSelector?: string | undefined;
  errorIndicatorSelector?: string | undefined;
}

export interface UiAuthContext {
  roleId: string;
  strategy: AuthStrategy;
  username?: string | undefined;
  password?: string | undefined;
}

export async function authenticateWithUi(
  surface: BrowserAuthSurface,
  ctx: UiAuthContext,
  options: UiAuthOptions,
) {
  if (!ctx.username || !ctx.password) {
    return blocked(ctx.roleId, ctx.strategy, 'credentials-missing', 'Missing username or password credential.', false);
  }

  await surface.goto(options.loginUrl);
  await surface.fill(options.usernameSelector, ctx.username);
  await surface.fill(options.passwordSelector, ctx.password);
  await surface.click(options.submitSelector);

  if (
    options.errorIndicatorSelector &&
    (await surface.isVisible(options.errorIndicatorSelector))
  ) {
    const text = (await surface.getText(options.errorIndicatorSelector)) ?? 'Login failed';
    return blocked(ctx.roleId, ctx.strategy, 'login-failed', text, false);
  }

  if (
    options.successIndicatorSelector &&
    !(await surface.isVisible(options.successIndicatorSelector))
  ) {
    // No explicit error but success never materialized — likely an SSO/MFA wall.
    return blocked(
      ctx.roleId,
      ctx.strategy,
      'sso-mfa-required',
      'SSO/MFA wall detected after submit.',
      true,
    );
  }

  const storageState = await surface.captureStorageState();
  if (storageState.cookies.length === 0 && storageState.origins.length === 0) {
    return blocked(ctx.roleId, ctx.strategy, 'login-failed', 'No session cookies were produced.', false);
  }

  return success(ctx.roleId, ctx.strategy, storageState);
}
