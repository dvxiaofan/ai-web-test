import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
  Response,
} from "playwright";

import { stableId } from "../core/ids.js";
import { evaluateUrlAccess } from "./host-policy.js";
import { classifyActionRisk } from "./risk.js";
import type {
  BrowserExplorationOptions,
  BrowserExplorationResult,
  BrowserPageObservation,
  ConsoleObservation,
  DiscoveredControl,
  DiscoveredLink,
  NetworkObservation,
  PageErrorObservation,
  PlaywrightLoader,
  SkippedBrowserTarget,
  UrlAccessDecision,
  VisualObservation,
  AccessibilityObservation,
} from "./types.js";

const DEFAULT_REDACT_QUERY_KEYS = [
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "code",
  "key",
  "password",
  "secret",
  "session",
  "token",
];
const MAX_CONSOLE_EVENTS = 250;
const MAX_NETWORK_EVENTS = 750;

interface NormalizedOptions {
  baseUrl: string;
  routes: string[];
  browserName: "chromium" | "firefox" | "webkit";
  headless: boolean;
  viewport: { width: number; height: number };
  navigationTimeoutMs: number;
  ignoreHTTPSErrors: boolean;
  settleTimeMs: number;
  maxPages: number;
  maxLinksPerPage: number;
  followLinks: boolean;
  captureScreenshots: boolean;
  screenshotDir?: string;
  allowedHosts: string[];
  blockedHosts: string[];
  redactQueryKeys: string[];
  playwrightLoader: PlaywrightLoader;
}

interface RawLink {
  text: string;
  href: string;
  target: string;
  ariaLabel: string;
  title: string;
}

interface RawControl {
  tagName: string;
  type: string;
  text: string;
  ariaLabel: string;
  title: string;
}

interface PageDiscovery {
  links: DiscoveredLink[];
  rawLinkUrls: string[];
}

/**
 * Explore a site in observation-only mode.
 *
 * The explorer never clicks controls or submits forms. It follows only links
 * classified as read-only, and every browser request is checked against the
 * host policy (including redirects and subresources).
 */
export async function exploreBrowser(options: BrowserExplorationOptions): Promise<BrowserExplorationResult> {
  const startedAt = new Date().toISOString();
  const normalized = normalizeOptions(options);
  const baseDecision = evaluateUrlAccess(normalized.baseUrl, normalized);
  if (!baseDecision.allowed || baseDecision.url === undefined || !isWebUrl(baseDecision.url)) {
    return unavailableResult(normalized, startedAt, `Invalid or unsafe base URL (${baseDecision.reason}).`);
  }

  let browser: Browser | undefined;
  const warnings: string[] = [];
  try {
    const playwright = await normalized.playwrightLoader();
    const browserType = playwright[normalized.browserName];
    browser = await browserType.launch({ headless: normalized.headless });
  } catch (error) {
    return unavailableResult(normalized, startedAt, explainUnavailable(error));
  }

  const pages: BrowserPageObservation[] = [];
  const skipped: SkippedBrowserTarget[] = [];

  try {
    const context = await browser.newContext({ viewport: normalized.viewport, ignoreHTTPSErrors: normalized.ignoreHTTPSErrors });
    await installHostGuard(context, normalized);
    const queue: string[] = [];
    const queued = new Set<string>();
    const visited = new Set<string>();

    enqueueTarget(normalized.baseUrl, normalized, queue, queued, skipped);
    for (const route of normalized.routes) {
      enqueueTarget(route, normalized, queue, queued, skipped);
    }

    while (queue.length > 0 && pages.length < normalized.maxPages) {
      const requestedUrl = queue.shift();
      if (requestedUrl === undefined) {
        break;
      }
      queued.delete(requestedUrl);
      if (visited.has(requestedUrl)) {
        skipped.push({ url: requestedUrl, reason: "duplicate" });
        continue;
      }
      visited.add(requestedUrl);

      const discovery = await observePage(context, requestedUrl, normalized, pages.length, warnings);
      const observation = discovery.observation;
      pages.push(observation);

      if (normalized.followLinks) {
        for (const [index, link] of observation.links.entries()) {
          if (link.risk !== "read") {
            continue;
          }
          const rawLinkUrl = discovery.rawLinkUrls[index];
          if (rawLinkUrl === undefined) continue;
          const before = queue.length;
          enqueueTarget(rawLinkUrl, normalized, queue, queued, skipped, visited);
          link.followed = queue.length > before || visited.has(canonicalUrl(rawLinkUrl));
          if (!link.followed) {
            const lastSkip = skipped.at(-1);
            if (lastSkip?.url === link.url) {
              link.skipReason = lastSkip.reason;
            }
          }
        }
      }
    }

    for (const remaining of queue) {
      skipped.push({ url: remaining, reason: "page-limit" });
    }
    await context.close().catch((error: unknown) => {
      warnings.push(`Could not close browser context cleanly: ${errorMessage(error)}`);
    });
  } catch (error) {
    warnings.push(`Browser exploration stopped early: ${errorMessage(error)}`);
  } finally {
    await browser.close().catch((error: unknown) => {
      warnings.push(`Could not close browser cleanly: ${errorMessage(error)}`);
    });
  }

  const hasPageFailure = pages.some((page) => page.error !== undefined || !page.rendered);
  return {
    status: hasPageFailure || warnings.length > 0 ? "partial" : "completed",
    baseUrl: normalized.baseUrl,
    browserName: normalized.browserName,
    startedAt,
    endedAt: new Date().toISOString(),
    pages,
    skipped,
    warnings,
    metadata: {
      requestPolicy: "base-origin-and-explicit-allowlist",
      observationOnly: true,
      pageLimit: normalized.maxPages,
    },
  };
}

async function observePage(
  context: BrowserContext,
  requestedUrl: string,
  options: NormalizedOptions,
  pageIndex: number,
  warnings: string[],
): Promise<PageDiscovery & { observation: BrowserPageObservation }> {
  const started = Date.now();
  const consoleEvents: ConsoleObservation[] = [];
  const pageErrors: PageErrorObservation[] = [];
  const network: NetworkObservation[] = [];
  const page = await context.newPage();

  page.on("console", (message) => recordConsole(message, consoleEvents));
  page.on("pageerror", (error) => {
    if (pageErrors.length < MAX_CONSOLE_EVENTS) {
      pageErrors.push({ name: error.name, message: redactText(error.message), timestamp: new Date().toISOString() });
    }
  });
  page.on("response", (response) => recordResponse(response, network, options));
  page.on("requestfailed", (request) => recordFailedRequest(request, network, options));
  page.on("popup", (popup) => {
    void popup.close().catch(() => undefined);
  });

  let response: Response | null = null;
  let title: string | undefined;
  let finalUrl: string | undefined;
  let links: DiscoveredLink[] = [];
  let rawLinkUrls: string[] = [];
  let controls: DiscoveredControl[] = [];
  let visualIssues: VisualObservation[] = [];
  let accessibilityIssues: AccessibilityObservation[] = [];
  let screenshotPath: string | undefined;
  let pageError: string | undefined;

  try {
    response = await page.goto(requestedUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.navigationTimeoutMs,
    });
    if (options.settleTimeMs > 0) {
      await page.waitForTimeout(options.settleTimeMs);
    }
    finalUrl = canonicalUrl(page.url());
    title = redactText(await page.title());
    const discoveredLinks = await discoverLinks(page, options);
    links = discoveredLinks.links;
    rawLinkUrls = discoveredLinks.rawLinkUrls;
    controls = await discoverControls(page);
    visualIssues = await discoverVisualIssues(page);
    accessibilityIssues = await discoverAccessibilityIssues(page);
    if (options.captureScreenshots && options.screenshotDir !== undefined) {
      try {
        screenshotPath = await captureScreenshot(page, options.screenshotDir, requestedUrl, pageIndex);
      } catch (error) {
        warnings.push(`Could not capture screenshot for ${sanitizeUrl(requestedUrl, options.redactQueryKeys)}: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    pageError = redactText(errorMessage(error));
    finalUrl = safeCanonicalUrl(page.url());
  } finally {
    await page.close().catch((error: unknown) => {
      warnings.push(`Could not close page ${sanitizeUrl(requestedUrl, options.redactQueryKeys)}: ${errorMessage(error)}`);
    });
  }

  const result: BrowserPageObservation = {
    requestedUrl: sanitizeUrl(requestedUrl, options.redactQueryKeys),
    rendered: pageError === undefined,
    links,
    controls,
    console: consoleEvents,
    pageErrors,
    network,
    visualIssues,
    accessibilityIssues,
    durationMs: Date.now() - started,
  };
  if (finalUrl !== undefined) result.finalUrl = sanitizeUrl(finalUrl, options.redactQueryKeys);
  if (title !== undefined) result.title = title;
  if (response !== null) result.httpStatus = response.status();
  if (screenshotPath !== undefined) result.screenshotPath = screenshotPath;
  if (pageError !== undefined) result.error = pageError;
  return { observation: result, links, rawLinkUrls };
}

async function discoverAccessibilityIssues(page: Page): Promise<AccessibilityObservation[]> {
  return page.evaluate(() => {
    const issues: Array<{
      rule: "image-alt" | "form-label" | "empty-control-name" | "duplicate-id" | "document-language";
      severity: "low" | "medium" | "high";
      message: string;
      selector?: string;
    }> = [];
    const selectorFor = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute("data-testid");
      return testId ? `[data-testid="${testId.replaceAll('"', '\\"')}"]` : element.tagName.toLowerCase();
    };
    if (!document.documentElement.lang.trim()) {
      issues.push({ rule: "document-language", severity: "low", message: "The document has no language declaration.", selector: "html" });
    }
    for (const image of [...document.querySelectorAll<HTMLImageElement>('img')].slice(0, 300)) {
      if (!image.hasAttribute('alt')) {
        issues.push({ rule: "image-alt", severity: "medium", message: "Image has no alt attribute.", selector: selectorFor(image) });
      }
    }
    for (const control of [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="hidden"]), select, textarea')].slice(0, 500)) {
      const labelled = Boolean(control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || (control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`)) || control.closest('label'));
      if (!labelled) {
        issues.push({ rule: "form-label", severity: "medium", message: "Form control has no programmatic label.", selector: selectorFor(control) });
      }
    }
    for (const control of [...document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')].slice(0, 500)) {
      const name = control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim();
      if (!name) {
        issues.push({ rule: "empty-control-name", severity: "high", message: "Interactive control has no accessible name.", selector: selectorFor(control) });
      }
    }
    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll<HTMLElement>('[id]')) {
      ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    }
    for (const [id, count] of ids) {
      if (count > 1) issues.push({ rule: "duplicate-id", severity: "medium", message: `ID ${id} appears ${count} times.`, selector: `#${CSS.escape(id)}` });
    }
    return issues.slice(0, 100);
  });
}

async function discoverVisualIssues(page: Page): Promise<VisualObservation[]> {
  return page.evaluate(() => {
    const issues: Array<{
      kind: "horizontal-overflow" | "clipped-text" | "tiny-control" | "offscreen-control";
      severity: "info" | "low" | "medium" | "high";
      message: string;
      selector?: string;
    }> = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 2) {
      issues.push({
        kind: "horizontal-overflow",
        severity: "medium",
        message: `Document width ${root.scrollWidth}px exceeds viewport width ${root.clientWidth}px.`,
        selector: "html",
      });
    }

    const selectorFor = (element: Element): string => {
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${testId.replaceAll('"', '\\"')}"]`;
      if (element.id) return `#${CSS.escape(element.id)}`;
      const name = element.getAttribute("name");
      return name ? `${element.tagName.toLowerCase()}[name="${name.replaceAll('"', '\\"')}"]` : element.tagName.toLowerCase();
    };

    const interactive = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"]')].slice(0, 500);
    for (const element of interactive) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const selector = selectorFor(element);
      if (rect.width < 24 || rect.height < 24) {
        issues.push({
          kind: "tiny-control",
          severity: "low",
          message: `Interactive control is only ${Math.round(rect.width)}×${Math.round(rect.height)}px.`,
          selector,
        });
      }
      if (rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight) {
        issues.push({
          kind: "offscreen-control",
          severity: "medium",
          message: "Interactive control is entirely outside the current viewport.",
          selector,
        });
      }
      if (issues.length >= 100) break;
    }

    if (issues.length < 100) {
      const candidates = [...document.querySelectorAll<HTMLElement>('h1, h2, h3, p, span, label, button, a')].slice(0, 1000);
      for (const element of candidates) {
        if (!element.textContent?.trim()) continue;
        const style = getComputedStyle(element);
        const clipped = element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2;
        const hidesOverflow = [style.overflow, style.overflowX, style.overflowY].some((value) => value === "hidden" || value === "clip");
        if (clipped && hidesOverflow) {
          issues.push({
            kind: "clipped-text",
            severity: "medium",
            message: "Visible text may be clipped by its container.",
            selector: selectorFor(element),
          });
        }
        if (issues.length >= 100) break;
      }
    }
    return issues;
  });
}

async function discoverLinks(page: Page, options: NormalizedOptions): Promise<PageDiscovery> {
  const rawLinks = await page.locator("a[href]").evaluateAll((elements) => {
    return elements.map((element) => {
      const anchor = element as HTMLAnchorElement;
      return {
        text: (anchor.innerText || anchor.textContent || "").trim(),
        href: anchor.href,
        target: anchor.target,
        ariaLabel: anchor.getAttribute("aria-label") ?? "",
        title: anchor.getAttribute("title") ?? "",
      };
    });
  }) as RawLink[];

  const links = rawLinks.slice(0, options.maxLinksPerPage).map((link) => {
    const access = evaluateUrlAccess(link.href, options);
    const classification = classifyActionRisk({
      kind: "link",
      text: link.text,
      ariaLabel: link.ariaLabel,
      title: link.title,
      href: link.href,
    });
    const discovered: DiscoveredLink = {
      text: redactText(link.text).slice(0, 500),
      url: sanitizeUrl(link.href, options.redactQueryKeys),
      risk: classification.risk,
      riskReason: classification.reason,
      followed: false,
    };
    if (link.target.length > 0) discovered.target = link.target;
    if (!access.allowed) discovered.skipReason = access.reason;
    else if (classification.risk !== "read") discovered.skipReason = "risky-navigation";
    return discovered;
  });
  return { links, rawLinkUrls: rawLinks.slice(0, options.maxLinksPerPage).map((link) => link.href) };
}

async function discoverControls(page: Page): Promise<DiscoveredControl[]> {
  const rawControls = await page
    .locator('button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]')
    .evaluateAll((elements) => {
      return elements.map((element) => {
        const htmlElement = element as HTMLElement;
        const input = element instanceof HTMLInputElement ? element : undefined;
        return {
          tagName: element.tagName.toLowerCase(),
          type: input?.type ?? element.getAttribute("type") ?? "",
          text: (input?.value || htmlElement.innerText || element.textContent || "").trim(),
          ariaLabel: element.getAttribute("aria-label") ?? "",
          title: element.getAttribute("title") ?? "",
        };
      });
    }) as RawControl[];

  return rawControls.slice(0, 300).map((control) => {
    const classification = classifyActionRisk({
      kind: "control",
      text: control.text,
      ariaLabel: control.ariaLabel,
      title: control.title,
      controlType: control.type,
    });
    const discovered: DiscoveredControl = {
      tagName: control.tagName,
      text: redactText(control.text).slice(0, 500),
      risk: classification.risk,
      riskReason: classification.reason,
    };
    if (control.type.length > 0) discovered.type = control.type;
    if (control.ariaLabel.length > 0) discovered.ariaLabel = redactText(control.ariaLabel);
    if (control.title.length > 0) discovered.title = redactText(control.title);
    return discovered;
  });
}

async function installHostGuard(context: BrowserContext, options: NormalizedOptions): Promise<void> {
  await context.route("**/*", async (route) => {
    const decision = evaluateUrlAccess(route.request().url(), options);
    if (decision.allowed) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

function recordConsole(message: ConsoleMessage, events: ConsoleObservation[]): void {
  if (events.length >= MAX_CONSOLE_EVENTS) return;
  const rawLocation = message.location();
  const event: ConsoleObservation = {
    type: message.type(),
    text: redactText(message.text()),
    timestamp: new Date().toISOString(),
  };
  if (rawLocation.url.length > 0) {
    event.location = {
      url: sanitizeUrl(rawLocation.url, DEFAULT_REDACT_QUERY_KEYS),
      lineNumber: rawLocation.lineNumber,
      columnNumber: rawLocation.columnNumber,
    };
  }
  events.push(event);
}

function recordResponse(response: Response, events: NetworkObservation[], options: NormalizedOptions): void {
  if (events.length >= MAX_NETWORK_EVENTS) return;
  const request = response.request();
  events.push({
    url: sanitizeUrl(response.url(), options.redactQueryKeys),
    method: request.method(),
    resourceType: request.resourceType(),
    status: response.status(),
    ok: response.ok(),
    blocked: false,
    timestamp: new Date().toISOString(),
  });
}

function recordFailedRequest(request: Request, events: NetworkObservation[], options: NormalizedOptions): void {
  if (events.length >= MAX_NETWORK_EVENTS) return;
  const access = evaluateUrlAccess(request.url(), options);
  const failure = request.failure()?.errorText;
  const event: NetworkObservation = {
    url: sanitizeUrl(request.url(), options.redactQueryKeys),
    method: request.method(),
    resourceType: request.resourceType(),
    blocked: !access.allowed,
    timestamp: new Date().toISOString(),
  };
  if (failure !== undefined) event.failure = redactText(failure);
  events.push(event);
}

async function captureScreenshot(page: Page, directory: string, url: string, index: number): Promise<string> {
  const absoluteDirectory = resolve(directory);
  await mkdir(absoluteDirectory, { recursive: true });
  const fileName = `${String(index + 1).padStart(3, "0")}-${stableId("page", canonicalUrl(url)).slice(0, 25)}.png`;
  const screenshotPath = resolve(absoluteDirectory, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

function enqueueTarget(
  candidate: string,
  options: NormalizedOptions,
  queue: string[],
  queued: Set<string>,
  skipped: SkippedBrowserTarget[],
  visited: Set<string> = new Set<string>(),
): void {
  if (hasUnresolvedRouteParameter(candidate)) {
    skipped.push({ url: candidate, reason: "dynamic-route", detail: "A concrete route parameter value is required." });
    return;
  }
  const access = evaluateUrlAccess(candidate, options);
  if (!access.allowed || access.url === undefined) {
    skipped.push({ url: candidate, reason: accessReasonToSkipReason(access), detail: access.reason });
    return;
  }
  if (!isWebUrl(access.url)) {
    skipped.push({ url: candidate, reason: "unsupported-protocol" });
    return;
  }
  const normalizedUrl = canonicalUrl(access.url);
  const risk = classifyActionRisk({ kind: "link", href: normalizedUrl });
  if (risk.risk !== "read") {
    skipped.push({ url: normalizedUrl, reason: "risky-navigation", detail: risk.reason, risk: risk.risk });
    return;
  }
  if (queued.has(normalizedUrl) || visited.has(normalizedUrl)) {
    skipped.push({ url: normalizedUrl, reason: "duplicate" });
    return;
  }
  queue.push(normalizedUrl);
  queued.add(normalizedUrl);
}

function normalizeOptions(options: BrowserExplorationOptions): NormalizedOptions {
  const browserName = options.browserName ?? "chromium";
  const screenshotDir = options.screenshotDir;
  return {
    baseUrl: options.baseUrl,
    routes: options.routes ?? [],
    browserName,
    headless: options.headless ?? true,
    viewport: options.viewport ?? { width: 1440, height: 900 },
    navigationTimeoutMs: boundedInteger(options.navigationTimeoutMs, 15_000, 250, 120_000),
    ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? false,
    settleTimeMs: boundedInteger(options.settleTimeMs, 100, 0, 10_000),
    maxPages: boundedInteger(options.maxPages, 25, 1, 1_000),
    maxLinksPerPage: boundedInteger(options.maxLinksPerPage, 200, 1, 5_000),
    followLinks: options.followLinks ?? true,
    captureScreenshots: options.captureScreenshots ?? screenshotDir !== undefined,
    ...(screenshotDir === undefined ? {} : { screenshotDir }),
    allowedHosts: options.allowedHosts ?? [],
    blockedHosts: options.blockedHosts ?? [],
    redactQueryKeys: [...new Set([...DEFAULT_REDACT_QUERY_KEYS, ...(options.redactQueryKeys ?? [])])],
    playwrightLoader: options.playwrightLoader ?? defaultPlaywrightLoader,
  };
}

async function defaultPlaywrightLoader(): Promise<typeof import("playwright")> {
  return import("playwright");
}

function unavailableResult(
  options: NormalizedOptions,
  startedAt: string,
  unavailableReason: string,
): BrowserExplorationResult {
  return {
    status: "unavailable",
    baseUrl: options.baseUrl,
    browserName: options.browserName,
    startedAt,
    endedAt: new Date().toISOString(),
    pages: [],
    skipped: [],
    warnings: [],
    unavailableReason,
    metadata: { observationOnly: true },
  };
}

function accessReasonToSkipReason(decision: UrlAccessDecision): SkippedBrowserTarget["reason"] {
  switch (decision.reason) {
    case "blocked-host":
      return "blocked-host";
    case "external-host":
      return "external-host";
    case "credentials-in-url":
      return "credentials-in-url";
    case "unsupported-protocol":
    case "allowed-local-scheme":
      return "unsupported-protocol";
    case "invalid-url":
      return "invalid-url";
    case "request-method-blocked":
      return "risky-navigation";
    case "allowed-base-origin":
    case "allowed-host":
      return "invalid-url";
  }
}

export function sanitizeUrl(rawUrl: string, additionalSensitiveKeys: string[] = []): string {
  try {
    const url = new URL(rawUrl);
    const sensitive = new Set([
      ...DEFAULT_REDACT_QUERY_KEYS,
      ...additionalSensitiveKeys,
    ].map((key) => key.toLowerCase()));
    for (const key of [...url.searchParams.keys()]) {
      if (sensitive.has(key.toLowerCase())) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return redactText(rawUrl);
  }
}

export function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, (match) => {
      const separatorIndex = Math.max(match.indexOf(":"), match.indexOf("="));
      const key = separatorIndex >= 0 ? match.slice(0, separatorIndex + 1) : "secret=";
      return `${key}[REDACTED]`;
    });
}

function canonicalUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  return url.href;
}

function safeCanonicalUrl(rawUrl: string): string | undefined {
  try {
    return canonicalUrl(rawUrl);
  } catch {
    return undefined;
  }
}

function hasUnresolvedRouteParameter(route: string): boolean {
  return /(^|\/)[:*][A-Za-z_][\w-]*|\[[.]{0,3}[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w-]*\}/.test(route);
}

function isWebUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function explainUnavailable(error: unknown): string {
  const message = errorMessage(error);
  if (/executable.*doesn['’]?t exist|browser.*not found|playwright install/i.test(message)) {
    return `Playwright is installed but its ${message.includes("firefox") ? "Firefox" : "browser"} executable is unavailable. Run the appropriate Playwright browser installation command. ${message}`;
  }
  if (/cannot find (package|module).*playwright|module not found/i.test(message)) {
    return `Playwright is unavailable in this installation. Install the optional browser dependency before runtime discovery. ${message}`;
  }
  return `Browser automation could not start. ${message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
