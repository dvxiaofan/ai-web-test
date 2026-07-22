import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export class InteractivePrompt {
  readonly #terminal = createInterface({ input: stdin, output: stdout });

  async select<T extends string>(question: string, options: Array<SelectOption<T>>): Promise<T> {
    if (options.length === 0) throw new Error('Interactive selection requires at least one option.');
    stdout.write(`\n${question}\n`);
    options.forEach((option, index) => {
      stdout.write(`  ${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}\n`);
    });

    while (true) {
      const answer = (await this.#terminal.question(`Select 1-${options.length}: `)).trim();
      const index = Number.parseInt(answer, 10) - 1;
      const selected = options[index];
      if (selected) return selected.value;
      stdout.write('Please enter one of the displayed numbers.\n');
    }
  }

  async multiSelect<T extends string>(question: string, options: Array<SelectOption<T>>): Promise<T[]> {
    if (options.length === 0) return [];
    stdout.write(`\n${question}\n`);
    options.forEach((option, index) => {
      stdout.write(`  ${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}\n`);
    });

    while (true) {
      const answer = (await this.#terminal.question('Select comma-separated numbers (or "all"): ')).trim();
      if (answer.toLowerCase() === 'all') return options.map((option) => option.value);
      const indexes = answer.split(',').map((item) => Number.parseInt(item.trim(), 10) - 1);
      if (indexes.length > 0 && indexes.every((index) => options[index])) {
        return [...new Set(indexes.map((index) => options[index]?.value).filter((value): value is T => Boolean(value)))];
      }
      stdout.write('Please enter valid comma-separated option numbers.\n');
    }
  }

  async confirm(question: string, defaultValue = false): Promise<boolean> {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = (await this.#terminal.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    return answer === 'y' || answer === 'yes';
  }

  async input(question: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = (await this.#terminal.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || '';
  }

  close(): void {
    this.#terminal.close();
  }
}

export async function withPrompt<T>(callback: (prompt: InteractivePrompt) => Promise<T>): Promise<T> {
  const prompt = new InteractivePrompt();
  try {
    return await callback(prompt);
  } finally {
    prompt.close();
  }
}
