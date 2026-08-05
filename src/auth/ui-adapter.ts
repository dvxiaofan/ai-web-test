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
  waitForUrl(url: string): Promise<void>;
}

export interface PostLoginStep {
  action: "click" | "fill";
  selector: string;
  value?: string | undefined;
  waitForUrl?: string | undefined;
  delayMs?: number | undefined;
}

export interface UiAuthOptions {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successIndicatorSelector?: string | undefined;
  errorIndicatorSelector?: string | undefined;
  postLoginSteps?: PostLoginStep[] | undefined;
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

  for (const step of options.postLoginSteps ?? []) {
    if (step.waitForUrl) {
      await surface.waitForUrl(step.waitForUrl);
    }
    if (typeof step.delayMs === "number" && step.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }
    if (step.action === "click") {
      await surface.click(step.selector);
    } else if (step.action === "fill") {
      await surface.fill(step.selector, step.value ?? "");
    }
  }

  // 多步登录（选角色等）后，SPA 跳转与 localStorage 写入是异步的，
  // 需等待会话落地再捕获 storage state。
  await new Promise((resolve) => setTimeout(resolve, 4000));

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
