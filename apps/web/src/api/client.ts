import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

/**
 * Fully-typed API client generated from the server's own OpenAPI document
 * (issue #56 — "typed API client generated, not hand-written"). Regenerate
 * via `pnpm generate-api` whenever a route's request/response shape changes.
 * Requests are relative — Vite's dev proxy (and the production reverse
 * proxy) forward `/v1/*` to the Fastify API.
 */
export const api = createClient<paths>({ baseUrl: '/' });

/** Turns an RFC 7807 problem+json error body (or anything else) into a real `Error`. */
export function apiError(error: unknown): Error {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    return new Error(String(error.detail));
  }
  return new Error('Request failed');
}
