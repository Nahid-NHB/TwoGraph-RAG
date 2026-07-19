import { describe, expect, it } from 'vitest';
import { GraphError, NotFoundError, ValidationError } from '@twograph/core';
import { toProblemDetails } from '@twograph/server';

describe('toProblemDetails', () => {
  it('maps NotFoundError to a 404 problem', () => {
    const problem = toProblemDetails(new NotFoundError('symbol not found: x'));
    expect(problem).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'symbol not found: x',
    });
    expect(problem.type).toContain('not-found');
  });

  it('maps ValidationError to a 400 problem', () => {
    const problem = toProblemDetails(new ValidationError('bad input'));
    expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('maps GraphError(GRAPH_UNAVAILABLE) to a 503 problem', () => {
    const problem = toProblemDetails(new GraphError('GRAPH_UNAVAILABLE', 'memgraph down'));
    expect(problem).toMatchObject({ status: 503, code: 'GRAPH_UNAVAILABLE' });
  });

  it('maps a Fastify-style client error (statusCode < 500) through by status', () => {
    const err = Object.assign(new Error('invalid body'), {
      statusCode: 400,
      code: 'FST_ERR_VALIDATION',
    });
    const problem = toProblemDetails(err);
    expect(problem).toMatchObject({
      status: 400,
      code: 'FST_ERR_VALIDATION',
      detail: 'invalid body',
    });
  });

  it('maps an unknown/opaque error to a generic 500 problem without leaking internals', () => {
    const problem = toProblemDetails(new Error('some internal stack trace detail'));
    expect(problem).toEqual({
      type: 'https://twograph.dev/errors/internal',
      title: 'INTERNAL',
      status: 500,
      detail: 'An unexpected error occurred',
      code: 'INTERNAL',
    });
  });

  it('maps a non-Error thrown value to the same generic 500 problem', () => {
    const problem = toProblemDetails('just a string');
    expect(problem.status).toBe(500);
    expect(problem.code).toBe('INTERNAL');
  });
});
