/**
 * Typed error hierarchy. Every error carries a stable machine-readable `code`
 * so surfaces (REST problem+json, MCP, CLI) can map errors without string matching.
 */

export type ErrorCode =
  | 'INVALID_ID'
  | 'CONFIG_INVALID'
  | 'PARSE_FAILED'
  | 'GRAPH_UNAVAILABLE'
  | 'GRAPH_QUERY_FAILED'
  | 'STORE_FAILED'
  | 'EMBEDDING_FAILED'
  | 'VECTOR_STORE_FAILED'
  | 'RETRIEVAL_FAILED'
  | 'LLM_FAILED'
  | 'LLM_RATE_LIMITED'
  | 'EDIT_INVALID'
  | 'EDIT_STALE'
  | 'EDIT_NOT_PREVIEWED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INTERNAL';

export class TwoGraphError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options?.details;
  }
}

export class InvalidIdError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('INVALID_ID', message, options);
  }
}

export class ConfigError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('CONFIG_INVALID', message, options);
  }
}

export class ParseError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('PARSE_FAILED', message, options);
  }
}

export class GraphError extends TwoGraphError {
  constructor(
    code: Extract<ErrorCode, 'GRAPH_UNAVAILABLE' | 'GRAPH_QUERY_FAILED'>,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

export class StoreError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('STORE_FAILED', message, options);
  }
}

export class EmbeddingError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('EMBEDDING_FAILED', message, options);
  }
}

export class VectorStoreError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('VECTOR_STORE_FAILED', message, options);
  }
}

export class RetrievalError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('RETRIEVAL_FAILED', message, options);
  }
}

export class LlmError extends TwoGraphError {
  constructor(
    code: Extract<ErrorCode, 'LLM_FAILED' | 'LLM_RATE_LIMITED'>,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

export class EditError extends TwoGraphError {
  constructor(
    code: Extract<ErrorCode, 'EDIT_INVALID' | 'EDIT_STALE' | 'EDIT_NOT_PREVIEWED'>,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

export class NotFoundError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('NOT_FOUND', message, options);
  }
}

export class ValidationError extends TwoGraphError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('VALIDATION_FAILED', message, options);
  }
}

/** Wraps unknown thrown values into a TwoGraphError without losing the original. */
export function toTwoGraphError(err: unknown): TwoGraphError {
  if (err instanceof TwoGraphError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new TwoGraphError('INTERNAL', message, { cause: err });
}
