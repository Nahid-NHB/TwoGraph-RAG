import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer } from '@twograph/server';

interface RepoDto {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  lastIndexed: string | null;
}

interface IndexRunKickoffDto {
  runId: string;
}

interface IndexRunStatusDto {
  id: string;
  repoId: string;
  kind: string;
  filesAdded: number;
  filesChanged: number;
  filesRemoved: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

interface SearchHitDto {
  symbolId: string;
  score: number;
  source: string;
  name: string | null;
  path: string | null;
  kind: string | null;
  snippet: string | null;
}

interface SearchResponseDto {
  hits: SearchHitDto[];
}

interface SymbolDetailDto {
  id: string;
  name: string;
  kind: string;
  path: string;
  signature: string | null;
  doc: string | null;
  startLine: number;
  endLine: number;
  code: string;
  neighbors: unknown;
}

interface HierarchyEntryDto {
  id: string;
  name: string;
  kind: string;
  path: string | null;
  depth: number;
}

interface GraphQueryResponseDto {
  rows: Record<string, unknown>[];
}

interface SubgraphResponseDto {
  nodes: { id: string; name: string; kind: string; path: string | null }[];
  edges: { from: string; to: string; type: string }[];
}

interface FileTreeNodeDto {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: FileTreeNodeDto[];
}

interface FileTreeResponseDto {
  tree: FileTreeNodeDto[];
}

interface ProblemDetailsDto {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
}

function json<T>(res: LightMyRequestResponse): T {
  return res.json<T>();
}

let root: string;
let app: FastifyInstance;
let repoId: string;

async function waitForRunFinished(runId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/v1/repos/${repoId}/index/runs/${runId}` });
    const body = json<IndexRunStatusDto>(res);
    if (body.finishedAt) {
      if (body.error) throw new Error(`index run failed: ${body.error}`);
      return;
    }
    if (Date.now() > deadline) throw new Error('index run did not finish in time');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'twograph-server-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({ embedder: { provider: 'mock' } }),
  );

  app = await buildServer();
  await app.ready();

  const registerRes = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { rootPath: root, name: 'server-fixture' },
  });
  expect(registerRes.statusCode).toBe(201);
  repoId = json<RepoDto>(registerRes).id;

  const indexRes = await app.inject({
    method: 'POST',
    url: `/v1/repos/${repoId}/index`,
    payload: {},
  });
  expect(indexRes.statusCode).toBe(202);
  await waitForRunFinished(json<IndexRunKickoffDto>(indexRes).runId);
}, 60_000);

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('@twograph/server routes', () => {
  it('lists and fetches the registered repo', async () => {
    const list = await app.inject({ method: 'GET', url: '/v1/repos' });
    expect(list.statusCode).toBe(200);
    expect(json<RepoDto[]>(list).map((r) => r.id)).toContain(repoId);

    const detail = await app.inject({ method: 'GET', url: `/v1/repos/${repoId}` });
    expect(detail.statusCode).toBe(200);
    expect(json<RepoDto>(detail)).toMatchObject({ id: repoId, name: 'server-fixture' });
  });

  it('reports index run status as finished with no errors', async () => {
    const indexRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/index`,
      payload: {},
    });
    const runId = json<IndexRunKickoffDto>(indexRes).runId;
    await waitForRunFinished(runId);
    const status = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/index/runs/${runId}`,
    });
    expect(json<IndexRunStatusDto>(status)).toMatchObject({ id: runId, error: null });
  });

  it('searches in keyword mode and surfaces the auth fixture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/search`,
      payload: { query: 'verify token signature', mode: 'keyword', k: 5 },
    });
    expect(res.statusCode).toBe(200);
    const { hits } = json<SearchResponseDto>(res);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.path === 'auth/jwt.ts')).toBe(true);
    expect(hits.every((h) => h.source === 'bm25')).toBe(true);
  });

  it('searches in hybrid mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/search`,
      payload: { query: 'verify token signature', mode: 'hybrid', k: 5 },
    });
    expect(res.statusCode).toBe(200);
    const { hits } = json<SearchResponseDto>(res);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('returns symbol detail with code, signature, and neighbors', async () => {
    const symbolId = `${repoId}:auth/jwt.ts#verifyToken`;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/symbols/${encodeURIComponent(symbolId)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = json<SymbolDetailDto>(res);
    expect(body.code).toContain('function verifyToken');
    expect(body.signature).toContain('verifyToken');
    expect(body.neighbors).toBeDefined();
  });

  it('returns 404 for an unknown symbol id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/symbols/${encodeURIComponent(`${repoId}:nope.ts#ghost`)}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('returns callers of verifyToken including isAuthorized', async () => {
    const symbolId = `${repoId}:auth/jwt.ts#verifyToken`;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/symbols/${encodeURIComponent(symbolId)}/callers`,
    });
    expect(res.statusCode).toBe(200);
    const callers = json<HierarchyEntryDto[]>(res);
    expect(callers.map((c) => c.name)).toContain('isAuthorized');
  });

  it('returns component usage as a well-formed array', async () => {
    const componentId = `${repoId}:components/Button.tsx#Button`;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/components/${encodeURIComponent(componentId)}/usage`,
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(json<HierarchyEntryDto[]>(res))).toBe(true);
  });

  it('runs the who_calls graph template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/graph/query`,
      payload: { template: 'who_calls', params: { name: 'verifyToken' } },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = json<GraphQueryResponseDto>(res);
    expect(rows.some((r) => r.name === 'isAuthorized')).toBe(true);
  });

  it('rejects an unknown graph template with a validation problem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/graph/query`,
      payload: { template: 'not_a_real_template', params: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('returns a subgraph around verifyToken', async () => {
    const symbolId = `${repoId}:auth/jwt.ts#verifyToken`;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/graph/subgraph?root=${encodeURIComponent(symbolId)}&depth=1`,
    });
    expect(res.statusCode).toBe(200);
    const body = json<SubgraphResponseDto>(res);
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  it('returns the file explorer tree containing the auth directory', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/repos/${repoId}/files/tree` });
    expect(res.statusCode).toBe(200);
    const { tree } = json<FileTreeResponseDto>(res);
    expect(tree.some((n) => n.name === 'auth')).toBe(true);
  });

  it('returns a 404 problem+json for an unregistered repo', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/repos/not-a-real-repo-id' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(json<ProblemDetailsDto>(res)).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('returns a 400 problem+json for an invalid repo registration body', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/repos', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('serves an OpenAPI document generated from the zod schemas', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = json<{ paths: Record<string, unknown> }>(res);
    expect(spec.paths['/v1/repos']).toBeDefined();
    expect(
      spec.paths['/v1/repos/:repo/search'] ?? spec.paths['/v1/repos/{repo}/search'],
    ).toBeDefined();
  });
});
