import { describe, expect, it } from 'vitest';
import { ConfigError, defaultConfig, type TwoGraphConfig } from '@twograph/core';
import {
  AnthropicProvider,
  createLlmProvider,
  GeminiProvider,
  MockLlmProvider,
  OllamaProvider,
  OpenAiProvider,
  OpenRouterProvider,
} from '@twograph/llm';

function configWithLlm(llm: TwoGraphConfig['llm']): TwoGraphConfig {
  return { ...defaultConfig(), llm };
}

describe('createLlmProvider', () => {
  it('returns a MockLlmProvider for provider "mock" regardless of env', () => {
    const config = configWithLlm({ provider: 'mock', model: 'x' });
    expect(createLlmProvider(config, {})).toBeInstanceOf(MockLlmProvider);
  });

  it('creates an OpenAiProvider when configured, reading the key only from env', () => {
    const config = configWithLlm({ provider: 'openai', model: 'gpt-4o-mini', apiKeyEnv: 'MY_KEY' });
    const provider = createLlmProvider(config, { MY_KEY: 'sk-test' });
    expect(provider).toBeInstanceOf(OpenAiProvider);
  });

  it('creates an AnthropicProvider using the default apiKeyEnv when unset', () => {
    const config = configWithLlm({ provider: 'anthropic', model: 'claude-sonnet-5' });
    const provider = createLlmProvider(config, { ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('swapping providers is a config change only — same call site, different result', () => {
    const openai = createLlmProvider(configWithLlm({ provider: 'openai', model: 'gpt-4o-mini' }), {
      OPENAI_API_KEY: 'sk-test',
    });
    const anthropic = createLlmProvider(
      configWithLlm({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
    );
    expect(openai.id).toBe('openai');
    expect(anthropic.id).toBe('anthropic');
  });

  it('throws ConfigError when the API key env var is missing', () => {
    const config = configWithLlm({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(() => createLlmProvider(config, {})).toThrow(ConfigError);
  });

  it('never reads a literal apiKey from config — only the named env var', () => {
    const config = configWithLlm({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyEnv: 'SOME_VAR',
    });
    // A same-named key sitting elsewhere in env must not leak in; only SOME_VAR counts.
    expect(() => createLlmProvider(config, { OPENAI_API_KEY: 'sk-should-be-ignored' })).toThrow(
      ConfigError,
    );
  });

  it('creates a GeminiProvider, reading GEMINI_API_KEY by default', () => {
    const config = configWithLlm({ provider: 'gemini', model: 'gemini-2.5-flash' });
    const provider = createLlmProvider(config, { GEMINI_API_KEY: 'g-test' });
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('creates an OpenRouterProvider, reading OPENROUTER_API_KEY by default', () => {
    const config = configWithLlm({ provider: 'openrouter', model: 'meta-llama/llama-3.1-70b' });
    const provider = createLlmProvider(config, { OPENROUTER_API_KEY: 'or-test' });
    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });

  it('creates an OllamaProvider without requiring any API key', () => {
    const config = configWithLlm({ provider: 'ollama', model: 'llama3' });
    const provider = createLlmProvider(config, {});
    expect(provider).toBeInstanceOf(OllamaProvider);
  });
});
