import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '@twograph/server';

interface EditSummary {
  id: string;
  repoId: string;
  operation: string;
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'reverted';
  createdAt: string;
  resolvedAt: string | null;
  diff: string;
  affectedFiles: string[];
}

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
}

let root: string;
let app: FastifyInstance;
let repoId: string;

async function waitForRunFinished(runId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/v1/repos/${repoId}/index/runs/${runId}` });
    if (res.json<{ finishedAt: string | null }>().finishedAt) return;
    if (Date.now() > deadline) throw new Error('index run did not finish in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'twograph-server-edits-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({ embedder: { provider: 'mock' }, llm: { provider: 'mock', model: 'mock' } }),
  );

  app = await buildServer();
  await app.ready();

  const registerRes = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { rootPath: root, name: 'edits-fixture' },
  });
  repoId = registerRes.json<{ id: string }>().id;

  const indexRes = await app.inject({
    method: 'POST',
    url: `/v1/repos/${repoId}/index`,
    payload: {},
  });
  await waitForRunFinished(indexRes.json<{ runId: string }>().runId);
}, 60_000);

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('@twograph/server edit routes', () => {
  it('drives the full propose -> approve -> revert lifecycle over HTTP', async () => {
    const symbolId = `${repoId}:auth/jwt.ts#verifyToken`;

    const propose = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits`,
      payload: { operation: 'rename_symbol', params: { symbolId, newName: 'verifyJwt' } },
    });
    expect(propose.statusCode).toBe(201);
    const proposed = propose.json<EditSummary>();
    expect(proposed.status).toBe('pending');
    expect(proposed.diff).toContain('-export function verifyToken(');
    expect(proposed.diff).toContain('+export function verifyJwt(');
    expect(proposed.affectedFiles).toContain('auth/jwt.ts');

    const list = await app.inject({ method: 'GET', url: `/v1/repos/${repoId}/edits` });
    expect(list.statusCode).toBe(200);
    expect(list.json<EditSummary[]>().map((e) => e.id)).toContain(proposed.id);

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/edits/${proposed.id}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<EditSummary>()).toMatchObject({ id: proposed.id, status: 'pending' });

    const approve = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits/${proposed.id}/approve`,
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json<EditSummary>().status).toBe('applied');
    expect(readFileSync(join(root, 'auth/jwt.ts'), 'utf8')).toContain('export function verifyJwt(');

    const revert = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits/${proposed.id}/revert`,
    });
    expect(revert.statusCode).toBe(200);
    expect(revert.json<EditSummary>().status).toBe('reverted');
    expect(readFileSync(join(root, 'auth/jwt.ts'), 'utf8')).toContain(
      'export function verifyToken(',
    );
  }, 30_000);

  it('rejects a pending edit without touching disk', async () => {
    const symbolId = `${repoId}:auth/jwt.ts#validateJWT`;
    const propose = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits`,
      payload: {
        operation: 'rename_symbol',
        params: { symbolId, newName: 'validateJwtSignature' },
      },
    });
    const proposed = propose.json<EditSummary>();

    const reject = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits/${proposed.id}/reject`,
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json<EditSummary>().status).toBe('rejected');
    expect(readFileSync(join(root, 'auth/jwt.ts'), 'utf8')).toContain(
      'export function validateJWT(',
    );
  });

  it('returns a 409 problem+json when approving after the file changed since preview', async () => {
    const symbolId = `${repoId}:auth/jwt.ts#signToken`;
    const propose = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits`,
      payload: { operation: 'rename_symbol', params: { symbolId, newName: 'signJwt' } },
    });
    const proposed = propose.json<EditSummary>();

    const original = readFileSync(join(root, 'auth/jwt.ts'), 'utf8');
    writeFileSync(join(root, 'auth/jwt.ts'), `${original}\n// drifted since preview\n`);

    const approve = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/edits/${proposed.id}/approve`,
    });
    expect(approve.statusCode).toBe(409);
    expect(approve.headers['content-type']).toContain('application/problem+json');
    expect(approve.json<ProblemDetails>().code).toBe('EDIT_STALE');

    writeFileSync(join(root, 'auth/jwt.ts'), original);
  });

  it('returns a 404 problem+json for an unknown edit id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/edits/not-a-real-edit-id`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});
