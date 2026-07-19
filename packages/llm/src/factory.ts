import { ConfigError, type TwoGraphConfig } from '@twograph/core';
import { MockLlmProvider } from './mock.js';
import type { LlmProvider } from './provider.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider, OllamaProvider, OpenRouterProvider } from './providers/compatible.js';
import { OpenAiProvider } from './providers/openai.js';

/**
 * Builds the configured provider (docs FR-6.2: provider swap = config change
 * only). API keys are only ever read from `env[config.llm.apiKeyEnv]` — never
 * accepted as a literal config value — so secrets never round-trip through
 * `.twograph/config.json`. Ollama is the one exception: it's fully local and
 * needs no real key.
 */
export function createLlmProvider(
  config: TwoGraphConfig,
  env: Record<string, string | undefined> = process.env,
): LlmProvider {
  const { provider, model, baseUrl, apiKeyEnv } = config.llm;

  if (provider === 'mock') {
    return new MockLlmProvider(['(mock response)'], { model });
  }
  if (provider === 'ollama') {
    const apiKey = apiKeyEnv ? env[apiKeyEnv] : undefined;
    return new OllamaProvider({
      model,
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
  }

  const keyEnvVar = apiKeyEnv ?? defaultApiKeyEnv(provider);
  const apiKey = keyEnvVar ? env[keyEnvVar] : undefined;
  if (!apiKey) {
    throw new ConfigError(
      `llm.provider is "${provider}" but no API key was found in env var "${keyEnvVar ?? '(unset apiKeyEnv)'}"`,
    );
  }

  switch (provider) {
    case 'openai':
      return new OpenAiProvider({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) });
    case 'anthropic':
      return new AnthropicProvider({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) });
    case 'gemini':
      return new GeminiProvider({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) });
    case 'openrouter':
      return new OpenRouterProvider({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) });
    default:
      throw new ConfigError(`unknown llm.provider: ${String(provider)}`);
  }
}

/** Env vars per provider (issue #42): the default when `llm.apiKeyEnv` is unset. */
function defaultApiKeyEnv(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'gemini':
      return 'GEMINI_API_KEY';
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    default:
      return undefined;
  }
}
