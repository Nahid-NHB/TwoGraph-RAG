export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: MessageRole;
  content: string;
  /** Present on assistant messages that invoked tools. */
  toolCalls?: ToolCall[];
  /** Present on tool-role messages — the id of the call being answered. */
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: Message[];
  /** Overrides the provider's configured default model for this call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  /** Aborting cancels the in-flight HTTP request to the provider (issue #47). */
  signal?: AbortSignal;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls';

export interface CompletionResult {
  content: string;
  toolCalls?: ToolCall[];
  usage: Usage;
  finishReason: FinishReason;
  model: string;
}

export type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'done'; result: CompletionResult };

/**
 * Provider-agnostic LLM contract (docs/09 §5, FR-6): normalized messages and
 * tool-calls so OpenAI/Anthropic/Gemini/Ollama/OpenRouter are interchangeable
 * by config alone. `stream` throws (not an error event) on failure — callers
 * use a normal try/catch around the for-await loop.
 */
export interface LlmProvider {
  readonly id: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  stream(request: CompletionRequest): AsyncIterable<StreamEvent>;
}
