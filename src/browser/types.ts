import type { ActionRisk, BrowserName, JsonObject } from "../core/types.js";

export type BrowserExplorationStatus = "completed" | "partial" | "unavailable";

export interface UrlAccessPolicy {
  /** URL used to resolve relative links and implicitly allowed as an origin. */
  baseUrl: string;
  /** Exact origins, hosts, hostnames, or `*.example.test` hostname patterns. */
  allowedHosts?: string[];
  /** Host patterns that always win over the allowlist. */
  blockedHosts?: string[];
}

export interface UrlAccessDecision {
  allowed: boolean;
  reason:
    | "allowed-base-origin"
    | "allowed-host"
    | "allowed-local-scheme"
    | "blocked-host"
    | "external-host"
    | "unsupported-protocol"
    | "credentials-in-url"
    | "invalid-url"
    | "request-method-blocked";
  url?: string;
  origin?: string;
}

export interface RiskCandidate {
  kind?: "link" | "control" | "form" | "request" | "unknown";
  text?: string;
  ariaLabel?: string;
  title?: string;
  href?: string;
  method?: string;
  controlType?: string;
}

export interface RiskClassification {
  risk: ActionRisk;
  reason: string;
  matchedKeyword?: string;
}

export interface DiscoveredLink {
  text: string;
  url: string;
  target?: string;
  risk: ActionRisk;
  riskReason: string;
  followed: boolean;
  skipReason?: string;
}

export interface DiscoveredControl {
  tagName: string;
  type?: string;
  text: string;
  ariaLabel?: string;
  title?: string;
  risk: ActionRisk;
  riskReason: string;
}

export interface ConsoleObservation {
  type: string;
  text: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
  timestamp: string;
}

export interface PageErrorObservation {
  name: string;
  message: string;
  timestamp: string;
}

export interface NetworkObservation {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  ok?: boolean;
  blocked: boolean;
  failure?: string;
  timestamp: string;
}

export interface VisualObservation {
  kind: "horizontal-overflow" | "clipped-text" | "tiny-control" | "offscreen-control";
  severity: "info" | "low" | "medium" | "high";
  message: string;
  selector?: string;
}

export interface AccessibilityObservation {
  rule: "image-alt" | "form-label" | "empty-control-name" | "duplicate-id" | "document-language";
  severity: "low" | "medium" | "high";
  message: string;
  selector?: string;
}

export interface BrowserPageObservation {
  requestedUrl: string;
  finalUrl?: string;
  title?: string;
  httpStatus?: number;
  rendered: boolean;
  links: DiscoveredLink[];
  controls: DiscoveredControl[];
  console: ConsoleObservation[];
  pageErrors: PageErrorObservation[];
  network: NetworkObservation[];
  visualIssues: VisualObservation[];
  accessibilityIssues: AccessibilityObservation[];
  screenshotPath?: string;
  error?: string;
  durationMs: number;
}

export interface SkippedBrowserTarget {
  url: string;
  reason:
    | "duplicate"
    | "invalid-url"
    | "external-host"
    | "blocked-host"
    | "unsupported-protocol"
    | "credentials-in-url"
    | "risky-navigation"
    | "dynamic-route"
    | "page-limit";
  detail?: string;
  risk?: ActionRisk;
}

export interface BrowserExplorationOptions extends UrlAccessPolicy {
  routes?: string[];
  browserName?: BrowserName;
  headless?: boolean;
  viewport?: { width: number; height: number };
  navigationTimeoutMs?: number;
  ignoreHTTPSErrors?: boolean;
  settleTimeMs?: number;
  maxPages?: number;
  maxLinksPerPage?: number;
  followLinks?: boolean;
  screenshotDir?: string;
  captureScreenshots?: boolean;
  redactQueryKeys?: string[];
  /** Test/embedding seam. Normal callers should leave this unset. */
  playwrightLoader?: PlaywrightLoader;
}

export interface BrowserExplorationResult {
  status: BrowserExplorationStatus;
  baseUrl: string;
  browserName: BrowserName;
  startedAt: string;
  endedAt: string;
  pages: BrowserPageObservation[];
  skipped: SkippedBrowserTarget[];
  warnings: string[];
  unavailableReason?: string;
  metadata?: JsonObject;
}

export type PlaywrightModule = typeof import("playwright");
export type PlaywrightLoader = () => Promise<PlaywrightModule>;
