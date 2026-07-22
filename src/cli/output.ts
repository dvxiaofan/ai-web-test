export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

export class CliOutput {
  readonly #options: OutputOptions;

  constructor(options: OutputOptions = {}) {
    this.#options = options;
  }

  info(message: string): void {
    if (!this.#options.quiet && !this.#options.json) process.stdout.write(`${message}\n`);
  }

  warn(message: string): void {
    if (!this.#options.json) process.stderr.write(`Warning: ${message}\n`);
  }

  result(value: unknown): void {
    if (this.#options.json) {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    } else if (typeof value === 'string') {
      process.stdout.write(`${value}\n`);
    }
  }

  error(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (this.#options.json) {
      process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
  }
}
