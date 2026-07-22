import type { AiConfig } from '../core/config.js';
import { DisabledAiProvider, OpenAiResponsesProvider, type AiProvider } from './provider.js';

export function createAiProvider(config: AiConfig): AiProvider {
  if (!config.enabled) return new DisabledAiProvider();
  switch (config.provider) {
    case 'openai-responses':
    case 'openai':
      if (!config.model) throw new Error('AI model is required when AI assistance is enabled.');
      return new OpenAiResponsesProvider({
        model: config.model,
        ...(config.apiKeyEnv ? { apiKeyEnv: config.apiKeyEnv } : {}),
      });
    default:
      throw new Error(`Unsupported AI provider: ${config.provider ?? '(missing)'}.`);
  }
}
