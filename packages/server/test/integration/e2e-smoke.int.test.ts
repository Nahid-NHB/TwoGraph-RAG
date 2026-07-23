import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockLlmProvider } from '@twograph/llm';
import { buildServer, RepoRegistry, repoIdFor } from '@twograph/server';

interface EditSummary {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'reverted';
}

interface ChatAnswer {
  content: string;
  citations: { file: string; symbolId: string; startLine: number; endLine: number }[];
  groundedContext: boolean;
}

interface HierarchyEntry {
  id: string;
  name: string;
}

let root: string;
let app: FastifyInstance;
let repoId: string;

async function waitForRunFinished(runId: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/v1/repos/${repoId}/index/runs/${runId}` });
    if (res.json<{ finishedAt: string | null }>().finishedAt) return;
    if (Date.now() > deadline) throw new Error('index run did not finish in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'twograph-e2e-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({ embedder: { provider: 'mock' }, llm: { provider: 'mock', model: 'mock' } }),
  );

  // Deterministic mock LLM (issue #73 explicitly calls for one): fixture[0]
  // answers the multiquery rewrite, fixture[1] the grounded generate call —
  // phrased to reliably surface the auth/ fixtures under MockEmbedder's
  // hashed bag-of-tokens similarity (same proven pairing as the rag package's
  // own pipeline.int.test.ts).
  const mockLlm = new MockLlmProvider([
    JSON.stringify({ queries: ['login authenticate verify token', 'jwt validation'] }),
    'Authentication verifies the bearer token [S1] using JWT validation [S2].',
  ]);

  const registry = new RepoRegistry();
  repoId = repoIdFor(root);
  registry.register(root, 'e2e-smoke-fixture', { llm: mockLlm });

  app = await buildServer({ registry });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

/**
 * The release gate (issue #73): boots the real HTTP server, then drives the
 * whole user journey exactly as a client would — index, hybrid search, ask a
 * golden question and verify its citations resolve to real file spans,
 * propose+approve a rename, and confirm the graph (not just the file text)
 * reflects it afterward. A single failure anywhere in this chain means the
 * system doesn't actually work end-to-end, regardless of how green the
 * per-package integration suites are.
 */
describe('release-gate e2e smoke: index -> search -> ask -> edit', () => {
  it('completes the full journey', async () => {
    // 1. Index the repo.
    const indexRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/index`,
      payload: {},
    });
    expect(indexRes.statusCode).toBe(202);
    const { runId } = indexRes.json<{ runId: string }>();
    await waitForRunFinished(runId);

    // 2. Hybrid search finds the auth fixtures.
    const searchRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/search`,
      payload: { query: 'verify jwt token', mode: 'hybrid', k: 10 },
    });
    expect(searchRes.statusCode).toBe(200);
    const { hits } = searchRes.json<{ hits: { path: string | null }[] }>();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.path?.startsWith('auth/'))).toBe(true);

    // 3. Ask a golden question — a grounded answer whose citations resolve
    // to real file spans on disk.
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/chat/sessions`,
      payload: {},
    });
    expect(sessionRes.statusCode).toBe(201);
    const session = sessionRes.json<{ id: string }>();

    const askRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/chat/sessions/${session.id}/messages`,
      payload: { question: 'how does authentication work?' },
    });
    expect(askRes.statusCode).toBe(200);
    const answer = askRes.json<ChatAnswer>();
    expect(answer.groundedContext).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
    for (const citation of answer.citations) {
      const lines = readFileSync(join(root, citation.file), 'utf8').split('\n');
      const span = lines.slice(citation.startLine - 1, citation.endLine).join('\n');
      expect(span.length).toBeGreaterThan(0);
    }

    // 4. Propose + approve a rename.
    const symbolId = `${repoId}:auth/jwt.ts#verifyToken`;
    const propose = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits`,
      payload: { operation: 'rename_symbol', params: { symbolId, newName: 'verifyJwtSignature' } },
    });
    expect(propose.statusCode).toBe(201);
    const proposed = propose.json<EditSummary>();
    expect(proposed.status).toBe('pending');

    const approve = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits/${proposed.id}/approve`,
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json<EditSummary>().status).toBe('applied');
    expect(readFileSync(join(root, 'auth/jwt.ts'), 'utf8')).toContain(
      'export function verifyJwtSignature(',
    );

    // 5. Post-edit graph consistency — the graph reflects the rename under
    // its new identity, not just the file text.
    const newSymbolId = `${repoId}:auth/jwt.ts#verifyJwtSignature`;
    const newSymbolRes = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/symbols/${encodeURIComponent(newSymbolId)}`,
    });
    expect(newSymbolRes.statusCode).toBe(200);
    expect(newSymbolRes.json<{ name: string }>().name).toBe('verifyJwtSignature');

    const oldSymbolRes = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/symbols/${encodeURIComponent(symbolId)}`,
    });
    expect(oldSymbolRes.statusCode).toBe(404);

    // Callers still resolve under the new identity — structural graph
    // consistency, not merely a text-search hit on the renamed file.
    const callersRes = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/symbols/${encodeURIComponent(newSymbolId)}/callers`,
    });
    expect(callersRes.statusCode).toBe(200);
    const callers = callersRes.json<HierarchyEntry[]>();
    expect(callers.some((c) => c.name === 'isAuthorized')).toBe(true);
  }, 120_000);
});
