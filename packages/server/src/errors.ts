import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { TwoGraphError, type ErrorCode } from '@twograph/core';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_ID: 400,
  CONFIG_INVALID: 400,
  PARSE_FAILED: 422,
  GRAPH_UNAVAILABLE: 503,
  GRAPH_QUERY_FAILED: 502,
  STORE_FAILED: 500,
  EMBEDDING_FAILED: 500,
  VECTOR_STORE_FAILED: 500,
  RETRIEVAL_FAILED: 500,
  LLM_FAILED: 502,
  LLM_RATE_LIMITED: 429,
  EDIT_INVALID: 400,
  EDIT_STALE: 409,
  EDIT_NOT_PREVIEWED: 400,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  INTERNAL: 500,
};

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
}

function slug(code: string): string {
  return code.toLowerCase().replaceAll('_', '-');
}

/** Maps any thrown error to an RFC 7807 problem+json body (issue #46). */
export function toProblemDetails(err: unknown): ProblemDetails {
  if (err instanceof TwoGraphError) {
    const status = STATUS_BY_CODE[err.code];
    return {
      type: `https://twograph.dev/errors/${slug(err.code)}`,
      title: err.code,
      status,
      detail: err.message,
      code: err.code,
    };
  }

  // Fastify's own errors (zod validation via fastify-type-provider-zod, 404
  // route-not-found, body-too-large, etc.) carry a statusCode; anything else
  // is treated as an opaque internal error so we never leak internals.
  const fastifyErr = err as Partial<FastifyError>;
  if (typeof fastifyErr.statusCode === 'number' && fastifyErr.statusCode < 500) {
    return {
      type: 'https://twograph.dev/errors/request-failed',
      title: fastifyErr.code ?? 'REQUEST_FAILED',
      status: fastifyErr.statusCode,
      detail: fastifyErr.message ?? 'Request could not be processed',
      code: fastifyErr.code ?? 'REQUEST_FAILED',
    };
  }

  return {
    type: 'https://twograph.dev/errors/internal',
    title: 'INTERNAL',
    status: 500,
    detail: 'An unexpected error occurred',
    code: 'INTERNAL',
  };
}

export function errorHandler(
  err: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const problem = toProblemDetails(err);
  request.log.error({ err, code: problem.code, status: problem.status }, 'request failed');
  void reply.code(problem.status).type('application/problem+json').send(problem);
}
