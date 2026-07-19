import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { LlmError } from '@twograph/core';
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LlmProvider,
  Message,
  StreamEvent,
  ToolCall,
  Usage,
} from '../provider.js';
import { withRetry } from '../retry.js';

function isTransient(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  const status = (err as { status?: number }).status;
  return status === 429 || (status !== undefined && status >= 500);
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof OpenAI.APIError) {
    return new LlmError(err.status === 429 ? 'LLM_RATE_LIMITED' : 'LLM_FAILED', err.message, {
      cause: err,
      details: { status: err.status, provider: 'openai' },
    });
  }
  return new LlmError('LLM_FAILED', String(err), { cause: err, details: { provider: 'openai' } });
}

function toOpenAiMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' };
    }
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOpenAiTools(tools: CompletionRequest['tools']): ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function buildBaseParams(
  request: CompletionRequest,
  defaultModel: string,
): {
  model: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  tools?: ChatCompletionTool[];
} {
  const tools = toOpenAiTools(request.tools);
  return {
    model: request.model ?? defaultModel,
    messages: toOpenAiMessages(request.messages),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    ...(tools ? { tools } : {}),
  };
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
  if (reason === 'tool_calls') return 'tool_calls';
  if (reason === 'length') return 'length';
  return 'stop';
}

function parseToolCallArgs(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** OpenAI implementation of the provider-agnostic LlmProvider contract. */
export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
    this.model = options.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    try {
      const response = await withRetry(
        () => this.client.chat.completions.create(buildBaseParams(request, this.model)),
        isTransient,
      );
      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
        .filter((tc): tc is typeof tc & { type: 'function' } => tc.type === 'function')
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: parseToolCallArgs(tc.function.arguments),
        }));
      return {
        content: message?.content ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : ZERO_USAGE,
        finishReason: mapFinishReason(choice?.finish_reason),
        model: response.model,
      };
    } catch (err) {
      throw toLlmError(err);
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const chatStream = await withRetry(
      () =>
        this.client.chat.completions.create({
          ...buildBaseParams(request, this.model),
          stream: true,
          stream_options: { include_usage: true },
        }),
      isTransient,
    ).catch((err: unknown) => {
      throw toLlmError(err);
    });

    let content = '';
    const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: FinishReason = 'stop';
    let usage: Usage = ZERO_USAGE;
    let model = request.model ?? this.model;

    try {
      for await (const chunk of chatStream) {
        model = chunk.model;
        const choice = chunk.choices[0];
        const delta = choice?.delta?.content;
        if (delta) {
          content += delta;
          yield { type: 'text-delta', delta };
        }
        for (const tc of choice?.delta?.tool_calls ?? []) {
          const existing = toolCallsByIndex.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
          toolCallsByIndex.set(tc.index, existing);
        }
        if (choice?.finish_reason) finishReason = mapFinishReason(choice.finish_reason);
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }
    } catch (err) {
      throw toLlmError(err);
    }

    const toolCalls: ToolCall[] = [...toolCallsByIndex.values()].map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: parseToolCallArgs(tc.args),
    }));
    for (const toolCall of toolCalls) yield { type: 'tool-call', toolCall };

    yield {
      type: 'done',
      result: {
        content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        usage,
        finishReason,
        model,
      },
    };
  }
}
