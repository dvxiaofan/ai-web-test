import { boundAiContext, redactSecrets } from './redaction.js';

export interface AiJsonRequest {
  task: string;
  instructions: string;
  schemaName: string;
  schemaDescription: string;
  input: unknown;
  images?: Array<{ mimeType: string; dataBase64: string; description?: string }>;
  /** Per-request override used to keep prompts within the configured budget. */
  maxContextChars?: number;
  /** Project-specific field names that should be treated as secrets. */
  additionalSecretKeys?: string[];
}

export interface AiJsonResponse<T> {
  value: T;
  provider: string;
  model: string;
  rawText?: string;
}

export interface AiProvider {
  readonly name: string;
  generateJson<T>(request: AiJsonRequest): Promise<AiJsonResponse<T>>;
}

export interface OpenAiResponsesProviderOptions {
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  organizationEnv?: string;
  projectEnv?: string;
  timeoutMs?: number;
  additionalSecretKeys?: string[];
  maxContextChars?: number;
}

interface ResponsesApiPayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

const MAX_PROVIDER_RESPONSE_CHARS = 2_000_000;

/**
 * Minimal provider for the OpenAI Responses API. It intentionally uses native
 * fetch so the core tool remains portable and does not require an AI SDK.
 */
export class OpenAiResponsesProvider implements AiProvider {
  readonly name = 'openai-responses';
  readonly #options: Required<Pick<OpenAiResponsesProviderOptions, 'model' | 'apiKeyEnv' | 'baseUrl' | 'timeoutMs'>> &
    Omit<OpenAiResponsesProviderOptions, 'model' | 'apiKeyEnv' | 'baseUrl' | 'timeoutMs'>;

  constructor(options: OpenAiResponsesProviderOptions) {
    this.#options = {
      ...options,
      apiKeyEnv: options.apiKeyEnv ?? 'OPENAI_API_KEY',
      baseUrl: (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      timeoutMs: options.timeoutMs ?? 60_000,
      maxContextChars: options.maxContextChars ?? 50_000,
    };
  }

  async generateJson<T>(request: AiJsonRequest): Promise<AiJsonResponse<T>> {
    const apiKey = process.env[this.#options.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`AI API key is missing. Set ${this.#options.apiKeyEnv}.`);
    }

    const redactedInput = redactSecrets(request.input, [
      ...(this.#options.additionalSecretKeys ?? []),
      ...(request.additionalSecretKeys ?? []),
    ]);
    const bounded = boundAiContext(redactedInput, request.maxContextChars ?? this.#options.maxContextChars);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);

    try {
      const response = await fetch(`${this.#options.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: this.#headers(apiKey),
        body: JSON.stringify({
          model: this.#options.model,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: [
                    'You are an assistant inside a web testing tool.',
                    'Return one JSON value only, with no Markdown fencing.',
                    'Never invent verified coverage. Mark uncertain conclusions explicitly.',
                    request.instructions,
                    `Expected JSON schema (${request.schemaName}): ${request.schemaDescription}`,
                  ].join('\n'),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    task: request.task,
                    input: bounded.value,
                    ...(bounded.truncated ? {
                      context: {
                        truncated: true,
                        originalChars: bounded.originalChars,
                        maxContextChars: bounded.maxContextChars,
                      },
                    } : {}),
                  }),
                },
                ...(request.images ?? []).map((image) => ({
                  type: 'input_image',
                  image_url: `data:${image.mimeType};base64,${image.dataBase64}`,
                  detail: 'high',
                })),
              ],
            },
          ],
        }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`AI provider returned HTTP ${response.status}: ${responseText.slice(0, 500)}`);
      }
      if (responseText.length > MAX_PROVIDER_RESPONSE_CHARS) {
        throw new Error(`AI provider response exceeded ${MAX_PROVIDER_RESPONSE_CHARS} characters.`);
      }
      let payload: ResponsesApiPayload;
      try {
        payload = JSON.parse(responseText) as ResponsesApiPayload;
      } catch (error) {
        throw new Error(`AI provider returned invalid response JSON: ${String(error)}`);
      }
      const rawText = extractOutputText(payload);
      if (!rawText) throw new Error('AI provider returned no text output.');

      let value: T;
      try {
        value = JSON.parse(stripCodeFence(rawText)) as T;
      } catch (error) {
        throw new Error(`AI provider returned invalid JSON: ${String(error)}`);
      }

      return { value, provider: this.name, model: this.#options.model, rawText };
    } finally {
      clearTimeout(timeout);
    }
  }

  #headers(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    };
    const organizationEnv = this.#options.organizationEnv;
    const projectEnv = this.#options.projectEnv;
    if (organizationEnv && process.env[organizationEnv]) {
      headers['OpenAI-Organization'] = process.env[organizationEnv];
    }
    if (projectEnv && process.env[projectEnv]) {
      headers['OpenAI-Project'] = process.env[projectEnv];
    }
    return headers;
  }
}

export class DisabledAiProvider implements AiProvider {
  readonly name = 'disabled';

  async generateJson<T>(_request: AiJsonRequest): Promise<AiJsonResponse<T>> {
    throw new Error('AI assistance is disabled. Configure an AI provider to use this feature.');
  }
}

function extractOutputText(payload: ResponsesApiPayload): string | undefined {
  if (payload.output_text) return payload.output_text;
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  return undefined;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}
