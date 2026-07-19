import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  StreamEvent,
  Usage,
} from './provider.js';

export type MockFixture = string | (Omit<CompletionResult, 'usage' | 'model'> & { usage?: Usage });

/** ~4 chars/token — good enough for deterministic mock usage accounting. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toResult(fixture: MockFixture, model: string, promptTokens: number): CompletionResult {
  if (typeof fixture === 'string') {
    const completionTokens = estimateTokens(fixture);
    return {
      content: fixture,
      finishReason: 'stop',
      model,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }
  const completionTokens = fixture.usage?.completionTokens ?? estimateTokens(fixture.content);
  return {
    ...fixture,
    model,
    usage: fixture.usage ?? {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Deterministic replay provider for tests and CI (issue #41): cycles through
 * a fixed list of canned fixtures, so RAG/multi-query tests never depend on
 * a live API. Recording real fixtures is a matter of pasting real responses
 * into the fixtures array — no separate record/replay machinery needed.
 */
export class MockLlmProvider implements LlmProvider {
  readonly id = 'mock';
  private readonly model: string;
  private readonly loop: boolean;
  private cursor = 0;
  readonly requests: CompletionRequest[] = [];

  constructor(
    private readonly fixtures: MockFixture[],
    options: { model?: string; loop?: boolean } = {},
  ) {
    this.model = options.model ?? 'mock-model';
    this.loop = options.loop ?? true;
  }

  private next(): MockFixture {
    if (this.fixtures.length === 0) {
      throw new Error('MockLlmProvider: no fixtures configured');
    }
    if (this.cursor >= this.fixtures.length) {
      if (!this.loop) throw new Error('MockLlmProvider: fixtures exhausted');
      this.cursor = 0;
    }
    return this.fixtures[this.cursor++]!;
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const promptTokens = estimateTokens(request.messages.map((m) => m.content).join('\n'));
    // Deferred via .then() (not async/await) so a throw from next() rejects
    // the promise instead of escaping synchronously.
    return Promise.resolve().then(() =>
      toResult(this.next(), request.model ?? this.model, promptTokens),
    );
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    this.requests.push(request);
    const promptTokens = estimateTokens(request.messages.map((m) => m.content).join('\n'));
    const result = toResult(this.next(), request.model ?? this.model, promptTokens);

    const words = result.content.length > 0 ? result.content.split(/(?<=\s)/) : [];
    for (const delta of words) {
      await Promise.resolve(); // simulate real streaming's async delivery
      yield { type: 'text-delta', delta };
    }
    for (const toolCall of result.toolCalls ?? []) {
      yield { type: 'tool-call', toolCall };
    }
    yield { type: 'done', result };
  }
}
