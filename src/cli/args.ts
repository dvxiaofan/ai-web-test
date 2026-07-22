export type CliOptionValue = string | boolean | string[];

export interface ParsedCliArgs {
  command: string;
  positionals: string[];
  options: Record<string, CliOptionValue>;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command = 'help', ...rest] = argv;
  const positionals: string[] = [];
  const options: Record<string, CliOptionValue> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith('--')) {
      if (token) positionals.push(token);
      continue;
    }

    if (token.startsWith('--no-')) {
      setOption(options, normalizeOptionName(token.slice(5)), false);
      continue;
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex >= 0) {
      setOption(
        options,
        normalizeOptionName(token.slice(2, equalsIndex)),
        token.slice(equalsIndex + 1),
      );
      continue;
    }

    const name = normalizeOptionName(token.slice(2));
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      setOption(options, name, next);
      index += 1;
    } else {
      setOption(options, name, true);
    }
  }

  return { command, positionals, options };
}

export function getStringOption(args: ParsedCliArgs, name: string): string | undefined {
  const value = args.options[normalizeOptionName(name)];
  if (Array.isArray(value)) return value.at(-1);
  return typeof value === 'string' ? value : undefined;
}

export function getBooleanOption(args: ParsedCliArgs, name: string, fallback = false): boolean {
  const value = args.options[normalizeOptionName(name)];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return !['false', '0', 'no', 'off'].includes(value.toLowerCase());
  if (Array.isArray(value)) {
    const last = value.at(-1);
    return last ? !['false', '0', 'no', 'off'].includes(last.toLowerCase()) : fallback;
  }
  return fallback;
}

export function getListOption(args: ParsedCliArgs, name: string): string[] {
  const value = args.options[normalizeOptionName(name)];
  if (value === undefined || typeof value === 'boolean') return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
}

function normalizeOptionName(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function setOption(target: Record<string, CliOptionValue>, name: string, value: string | boolean): void {
  const previous = target[name];
  if (previous === undefined) {
    target[name] = value;
  } else if (Array.isArray(previous)) {
    target[name] = [...previous, String(value)];
  } else {
    target[name] = [String(previous), String(value)];
  }
}
