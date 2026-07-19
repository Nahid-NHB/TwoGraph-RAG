import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
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

const DEFAULT_MAX_TOKENS = 4096;

function isTransient(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  const status = (err as { status?: number }).status;
  return status === 429 || (status !== undefined && status >= 500);
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.APIError) {
    return new LlmError(err.status === 429 ? 'LLM_RATE_LIMITED' : 'LLM_FAILED', err.message, {
      cause: err,
      details: { status: err.status, provider: 'anthropic' },
    });
  }
  return new LlmError('LLM_FAILED', String(err), {
    cause: err,
    details: { provider: 'anthropic' },
  });
}

/** Anthropic has no system role — it's a separate top-level param. */
function splitSystemPrompt(messages: Message[]): { system: string | undefined; rest: Message[] } {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const rest = messages.filter((m) => m.role !== 'system');
  return { system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, rest };
}

function toAnthropicMessages(messages: Message[]): MessageParam[] {
  return messages.map((m): MessageParam => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }],
      };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      };
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
  });
}

function toAnthropicTools(tools: CompletionRequest['tools']): Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object', ...t.parameters },
  }));
}

function buildBaseParams(
  request: CompletionRequest,
  rest: Message[],
  system: string | undefined,
  defaultModel: string,
): {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  system?: string;
  temperature?: number;
  tools?: Tool[];
} {
  const tools = toAnthropicTools(request.tools);
  return {
    model: request.model ?? defaultModel,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(rest),
    ...(system ? { system } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(tools ? { tools } : {}),
  };
}

function mapStopReason(reason: string | null | undefined): FinishReason {
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens') return 'length';
  return 'stop';
}

/** Anthropic implementation of the provider-agnostic LlmProvider contract. */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
    this.model = options.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const { system, rest } = splitSystemPrompt(request.messages);
    try {
      const response = await withRetry(
        () =>
          this.client.messages.create(buildBaseParams(request, rest, system, this.model), {
            ...(request.signal ? { signal: request.signal } : {}),
          }),
        isTransient,
      );

      const content = response.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolCalls: ToolCall[] = response.content
        .filter((b): b is ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          name: b.name,
          arguments: (b.input ?? {}) as Record<string, unknown>,
        }));

      return {
        content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        finishReason: mapStopReason(response.stop_reason),
        model: response.model,
      };
    } catch (err) {
      throw toLlmError(err);
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const { system, rest } = splitSystemPrompt(request.messages);
    const events = await withRetry(
      () =>
        this.client.messages.create(
          {
            ...buildBaseParams(request, rest, system, this.model),
            stream: true,
          },
          { ...(request.signal ? { signal: request.signal } : {}) },
        ),
      isTransient,
    ).catch((err: unknown) => {
      throw toLlmError(err);
    });

    let content = '';
    let model = request.model ?? this.model;
    let usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason: FinishReason = 'stop';
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

    try {
      for await (const event of events) {
        if (event.type === 'message_start') {
          model = event.message.model;
          usage = {
            promptTokens: event.message.usage.input_tokens,
            completionTokens: event.message.usage.output_tokens,
            totalTokens: event.message.usage.input_tokens + event.message.usage.output_tokens,
          };
        } else if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use'
        ) {
          toolBlocks.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            json: '',
          });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            content += event.delta.text;
            yield { type: 'text-delta', delta: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const block = toolBlocks.get(event.index);
            if (block) block.json += event.delta.partial_json;
          }
        } else if (event.type === 'message_delta') {
          finishReason = mapStopReason(event.delta.stop_reason);
          usage = {
            promptTokens: usage.promptTokens,
            completionTokens: event.usage.output_tokens,
            totalTokens: usage.promptTokens + event.usage.output_tokens,
          };
        }
      }
    } catch (err) {
      throw toLlmError(err);
    }

    const toolCalls: ToolCall[] = [...toolBlocks.values()].map((b) => ({
      id: b.id,
      name: b.name,
      arguments: parseToolArgs(b.json),
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

function parseToolArgs(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
