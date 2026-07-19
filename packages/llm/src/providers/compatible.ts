import type { CompletionRequest, CompletionResult, LlmProvider, StreamEvent } from '../provider.js';
import { OpenAiProvider } from './openai.js';

/**
 * Gemini, Ollama, and OpenRouter (issue #42) all expose an OpenAI-compatible
 * chat-completions endpoint, so each is a thin, differently-configured
 * OpenAiProvider rather than a bespoke SDK integration — same request
 * mapping, same retry/error handling, same conformance suite for free.
 */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';
  private readonly delegate: OpenAiProvider;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.delegate = new OpenAiProvider({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl ?? GEMINI_BASE_URL,
      id: this.id,
    });
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    return this.delegate.complete(request);
  }

  stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    return this.delegate.stream(request);
  }
}

/** Fully local — no real API key required, so `apiKey` is optional (a placeholder is used). */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama';
  private readonly delegate: OpenAiProvider;

  constructor(options: { model: string; baseUrl?: string; apiKey?: string }) {
    this.delegate = new OpenAiProvider({
      apiKey: options.apiKey ?? 'ollama',
      model: options.model,
      baseUrl: options.baseUrl ?? OLLAMA_BASE_URL,
      id: this.id,
    });
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    return this.delegate.complete(request);
  }

  stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    return this.delegate.stream(request);
  }
}

export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter';
  private readonly delegate: OpenAiProvider;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.delegate = new OpenAiProvider({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl ?? OPENROUTER_BASE_URL,
      id: this.id,
    });
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    return this.delegate.complete(request);
  }

  stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    return this.delegate.stream(request);
  }
}
