import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ProjectConfig } from '../core/config.js';
import type { BrowserAuthSurface } from '../auth/ui-adapter.js';
import type { StorageState } from '../auth/types.js';

export interface BrowserAuthSession {
  surface: BrowserAuthSurface;
  close: () => Promise<void>;
}

/**
 * Launch a headless browser and expose the minimal surface the UI auth adapter
 * drives. Used by the `auth` command to produce storage state for a role.
 */
export async function createBrowserAuthSession(config: ProjectConfig): Promise<BrowserAuthSession> {
  const profile = config.runtime.profiles[0]!;
  const browser: Browser = await chromium.launch({ headless: profile.headless });
  const context: BrowserContext = await browser.newContext({
    viewport: profile.viewport,
    ignoreHTTPSErrors: config.runtime.ignoreHTTPSErrors,
  });
  const page: Page = await context.newPage();
  return {
    surface: createSurface(page, context),
    close: async () => {
      await browser.close();
    },
  };
}

function createSurface(page: Page, context: BrowserContext): BrowserAuthSurface {
  return {
    goto: async (url) => {
      await page.goto(url);
    },
    fill: (selector, value) => page.fill(selector, value),
    click: (selector) => {
      if (selector.startsWith('getbytext:')) {
        return page.getByText(selector.slice('getbytext:'.length), { exact: false }).first().click();
      }
      return page.click(selector);
    },
    getUrl: async () => page.url(),
    getText: async (selector) => {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) return null;
      return (await locator.textContent()) ?? null;
    },
    isVisible: async (selector) => {
      const locator = page.locator(selector).first();
      return (await locator.count()) > 0 && (await locator.isVisible());
    },
    captureStorageState: async () => (await context.storageState()) as unknown as StorageState,
    waitForUrl: (url: string) => page.waitForURL(url),
  };
}
