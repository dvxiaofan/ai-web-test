const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|cookie|session)/i;

const TOKEN_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+\b/g,
  /\b(password|passwd|token|secret|api[-_]?key|access[-_]?token|refresh[-_]?token)\s*[:=]\s*(['"]?)[^\s,'";}]+\2/gi,
];

export function redactText(text: string): string {
  return TOKEN_PATTERNS.reduce((value, pattern) => value.replace(pattern, '[REDACTED]'), text);
}

/**
 * Report the literal secrets `redactText` would strip. Shares TOKEN_PATTERNS so
 * "what counts as a secret" has one definition across redaction and the
 * workspace audit in `agent/doctor`.
 */
export function findSecretMatches(text: string): string[] {
  const matches = new Set<string>();
  for (const pattern of TOKEN_PATTERNS) {
    // Patterns are module-level and carry /g, so reset lastIndex before reuse.
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0]) matches.add(match[0].trim());
    }
  }
  return [...matches];
}

export function redactSecrets(value: unknown, additionalSecretKeys: string[] = []): unknown {
  const seen = new WeakSet<object>();
  const explicitKeys = new Set(additionalSecretKeys.map((key) => key.toLowerCase()));

  const visit = (current: unknown, key?: string): unknown => {
    if (key && (SECRET_KEY_PATTERN.test(key) || explicitKeys.has(key.toLowerCase()))) {
      return '[REDACTED]';
    }
    if (typeof current === 'string') return redactText(current);
    if (current === null || typeof current !== 'object') return current;
    if (seen.has(current)) return '[CIRCULAR]';
    seen.add(current);

    if (Array.isArray(current)) return current.map((item) => visit(item));

    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        visit(entryValue, entryKey),
      ]),
    );
  };

  return visit(value);
}

export interface BoundedAiContext {
  value: unknown;
  truncated: boolean;
  originalChars: number;
  maxContextChars: number;
}

/**
 * Keep provider payloads bounded even when a large inventory is supplied.
 * The preview is deliberately wrapped as data instead of cutting a JSON
 * document in the middle, so the provider always receives valid JSON.
 */
export function boundAiContext(value: unknown, maxContextChars = 50_000): BoundedAiContext {
  const max = Math.max(1_000, Math.floor(maxContextChars));
  const serialized = JSON.stringify(value) ?? String(value);
  if (serialized.length <= max) {
    return { value, truncated: false, originalChars: serialized.length, maxContextChars: max };
  }

  const envelopeOverhead = 96;
  const preview = serialized.slice(0, Math.max(0, max - envelopeOverhead));
  return {
    value: {
      _aiWebTestContextTruncated: true,
      originalChars: serialized.length,
      preview,
    },
    truncated: true,
    originalChars: serialized.length,
    maxContextChars: max,
  };
}
