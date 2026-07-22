const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|cookie|session)/i;

const TOKEN_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+\b/g,
];

export function redactText(text: string): string {
  return TOKEN_PATTERNS.reduce((value, pattern) => value.replace(pattern, '[REDACTED]'), text);
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
