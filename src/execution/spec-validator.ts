import type { ControlledSpec, SpecIssue, SpecValidationContext, SpecValidationResult } from './spec-types.js';

const DEFAULT_REDACT_FIELDS = [
  'password',
  'passwd',
  'token',
  'secret',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'private_key',
];

const BEARER_PATTERN = /\bbearer\s+[a-z0-9._\-]{8,}/i;
const DANGEROUS_API_PATTERN =
  /child_process|require\(\s*['"]child_process|execSync?\(|spawn\(|eval\(|new\s+Function\(|process\.exit\(/i;
const RISKY_FILE_PATTERN = /fs\.(unlink|rm|rmdir|rmSync|unlinkSync|writeFile|writeFileSync|appendFile|readFileSync)|rm\s+-rf|del\(/i;
const NETWORK_BYPASS_PATTERN = /page\.route\(|context\.route\(|route\.fulfill\(|route\.abort\(|bypass/i;
const URL_PATTERN = /https?:\/\/[^\s'"]+/gi;
const EXISTENCE_ASSERTIONS = new Set(['visible', 'hidden', 'enabled', 'disabled', 'count']);

/**
 * Static (AST-free) governance validation of a Controlled Spec. Catches the
 * forbidden constructs listed in the Phase 5B acceptance criteria *before* the
 * spec is ever executed, so a bad spec fails fast at authoring / CI time.
 */
export function validateControlledSpec(
  spec: ControlledSpec,
  context: SpecValidationContext = {},
): SpecValidationResult {
  const errors: SpecIssue[] = [];
  const warnings: SpecIssue[] = [];
  const redactFields = context.redactFields ?? DEFAULT_REDACT_FIELDS;

  if (spec.skip !== undefined && (!spec.skip.reason || spec.skip.reason.trim().length === 0)) {
    errors.push({
      code: 'skip-without-reason',
      severity: 'error',
      message: 'A skipped spec must carry a reason.',
      location: 'skip.reason',
    });
  }

  const hasCleanupStep = (spec.cleanup?.length ?? 0) > 0 || spec.steps.some((step) => step.cleanup);
  if ((spec.risk === 'mutate' || spec.risk === 'destructive') && !hasCleanupStep) {
    errors.push({
      code: 'mutate-without-cleanup',
      severity: 'error',
      message: `Spec with ${spec.risk} risk must declare cleanup steps.`,
      location: 'cleanup',
    });
  }

  const allSteps = [...spec.steps, ...(spec.cleanup ?? [])];
  for (const step of allSteps) {
    const loc = `steps.${step.id}`;
    const texts: Array<{ text: string; where: string }> = [];
    if (step.value) texts.push({ text: step.value, where: `${loc}.value` });
    if (step.url) texts.push({ text: step.url, where: `${loc}.url` });
    if (step.expression) texts.push({ text: step.expression, where: `${loc}.expression` });
    if (step.expected !== undefined) texts.push({ text: String(step.expected), where: `${loc}.expected` });
    if (typeof step.body === 'string') texts.push({ text: step.body, where: `${loc}.body` });
    if (step.headers) {
      for (const [key, value] of Object.entries(step.headers)) {
        texts.push({ text: `${key}: ${value}`, where: `${loc}.headers.${key}` });
      }
    }

    for (const { text, where } of texts) {
      if (matchesHardcodedSecret(text, redactFields)) {
        errors.push({ code: 'hardcoded-secret', severity: 'error', message: `Possible hard-coded secret in ${where}.`, location: where });
      }
      if (DANGEROUS_API_PATTERN.test(text)) {
        errors.push({ code: 'dangerous-api', severity: 'error', message: `Disallowed API usage in ${where} (child_process/eval/spawn/exec).`, location: where });
      }
      if (RISKY_FILE_PATTERN.test(text)) {
        errors.push({ code: 'risky-file-access', severity: 'error', message: `Risky filesystem access in ${where}.`, location: where });
      }
      if (NETWORK_BYPASS_PATTERN.test(text)) {
        errors.push({ code: 'bypassed-network-policy', severity: 'error', message: `Attempt to bypass network policy in ${where}.`, location: where });
      }
      for (const url of extractUrls(text)) {
        if (!isApprovedUrl(url, context)) {
          errors.push({ code: 'unapproved-url', severity: 'error', message: `URL ${url} is not in the approved host allowlist.`, location: where });
        }
      }
    }

    if (step.locator) {
      if (step.locator.strategy === 'xpath' && step.locator.value.trim().startsWith('/html')) {
        errors.push({
          code: 'absolute-xpath',
          severity: 'error',
          message: "Absolute XPath '/html...' is forbidden (brittle). Use relative locators.",
          location: `${loc}.locator`,
        });
      }
      if (step.locator.strategy === 'css') {
        const value = step.locator.value;
        const fragile = /^#[\w-]+$/.test(value.trim()) || /:nth-/.test(value) || (value.match(/>/g)?.length ?? 0) > 2;
        if (fragile) {
          warnings.push({
            code: 'fragile-locator',
            severity: 'warning',
            message: `Fragile CSS locator in ${loc}.locator may be brittle.`,
            location: `${loc}.locator`,
          });
        }
      }
    }
  }

  const bodySteps = spec.steps.filter((step) => !step.cleanup);
  const assertions = bodySteps.filter((step) => step.action === 'assert');
  if (assertions.length === 0) {
    warnings.push({
      code: 'no-assertions',
      severity: 'warning',
      message: 'Spec has no assert steps; it cannot verify business behavior.',
    });
  } else if (assertions.every((step) => EXISTENCE_ASSERTIONS.has(step.assertion ?? ''))) {
    warnings.push({
      code: 'weakened-assertion',
      severity: 'warning',
      message: 'Spec only uses existence assertions; add content/value assertions to verify business behavior.',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function matchesHardcodedSecret(text: string, redactFields: string[]): boolean {
  const pattern = new RegExp(`(${redactFields.join('|')})\\s*[:=]\\s*['"]?[^\s'"{}$]{4,}`, 'i');
  const match = text.match(pattern) ?? text.match(BEARER_PATTERN);
  if (!match) return false;
  // Accept env references like ${TOKEN} or env:TOKEN — they are not hard-coded.
  return !/\$\{|env:/i.test(match[0]);
}

function extractUrls(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}

function isApprovedUrl(url: string, context: SpecValidationContext): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Without an explicit allowlist we cannot judge approval; never fail closed
  // on missing context so local specs authored without a policy still validate.
  const allowed = context.allowedHosts ?? [];
  if (allowed.length === 0 && !context.baseUrl) return true;

  const baseHost = context.baseUrl ? safeHost(context.baseUrl) : undefined;
  const allowedHosts = allowed.map((host) => (host === 'self' ? baseHost : host)).filter((host): host is string => host !== undefined);
  const host = parsed.hostname.toLowerCase();
  return allowedHosts.some((allowedHost) => {
    const normalized = allowedHost.toLowerCase();
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function safeHost(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
