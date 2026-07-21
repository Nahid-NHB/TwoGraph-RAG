import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockLlmProvider } from '@twograph/llm';
import { buildServer, RepoRegistry, repoIdFor } from '@twograph/server';

interface SseFrame {
  event: string;
  data: unknown;
}

/** Parses `event: X\ndata: {...}\n\n` frames out of an SSE response body. */
async function readSseFrames(res: Response): Promise<SseFrame[]> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('response has no body');
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: SseFrame[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value as Uint8Array, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (raw.startsWith(':')) continue; // heartbeat comment
      const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
      if (eventLine && dataLine) {
        frames.push({
          event: eventLine.slice('event: '.length),
          data: JSON.parse(dataLine.slice('data: '.length)) as unknown,
        });
      }
    }
  }
  return frames;
}

/** Reads SSE frames up to (and including) the `count`-th `token` event, then stops. */
async function readUntilTokenCount(res: Response, count: number): Promise<number> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('response has no body');
  const decoder = new TextDecoder();
  let buffer = '';
  let tokens = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value as Uint8Array, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (raw.includes('event: token')) {
        tokens += 1;
        if (tokens >= count) return tokens;
      }
    }
  }
  return tokens;
}

let root: string;
let app: FastifyInstance;
let registry: RepoRegistry;
let baseUrl: string;
let repoId: string;
let mockLlm: MockLlmProvider;

const MULTIQUERY_FIXTURE = JSON.stringify({
  queries: ['verify token signature', 'jwt validation'],
});
const GENERATE_FIXTURE = 'verifyToken checks the token signature [S1].';

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'twograph-server-chat-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({
      embedder: { provider: 'mock' },
      llm: { provider: 'mock', model: 'mock' },
    }),
  );

  mockLlm = new MockLlmProvider([MULTIQUERY_FIXTURE, GENERATE_FIXTURE], {
    model: 'mock',
    streamDelayMs: 20,
  });

  registry = new RepoRegistry();
  repoId = repoIdFor(root);
  registry.register(root, 'chat-fixture', { llm: mockLlm });

  app = await buildServer({ registry });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('expected a bound TCP address');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const indexRes = await app.inject({
    method: 'POST',
    url: `/v1/repos/${repoId}/index`,
    payload: {},
  });
  const { runId } = indexRes.json<{ runId: string }>();
  const deadline = Date.now() + 30_000;
  for (;;) {
    const status = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/index/runs/${runId}`,
    });
    if (status.json<{ finishedAt: string | null }>().finishedAt) break;
    if (Date.now() > deadline) throw new Error('index run did not finish in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}, 60_000);

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('@twograph/server chat routes', () => {
  it('creates a session, streams an SSE answer, and persists it into history', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/chat/sessions`,
      payload: {},
    });
    expect(sessionRes.statusCode).toBe(201);
    const session = sessionRes.json<{ id: string; repoId: string }>();
    expect(session.repoId).toBe(repoId);

    const res = await fetch(`${baseUrl}/v1/repos/${repoId}/chat/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ question: 'who calls verifyToken?' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = await readSseFrames(res);
    const eventTypes = frames.map((f) => f.event);

    // stage progress precedes token streaming, which precedes citations/done.
    expect(eventTypes[0]).toBe('stage');
    expect(eventTypes).toContain('token');
    expect(eventTypes.indexOf('citations')).toBeGreaterThan(eventTypes.lastIndexOf('token'));
    expect(eventTypes.at(-1)).toBe('done');
    expect(eventTypes).not.toContain('error');

    const tokenDeltas = frames
      .filter((f) => f.event === 'token')
      .map((f) => (f.data as { delta: string }).delta)
      .join('');
    expect(tokenDeltas).toBe(GENERATE_FIXTURE);

    const citationsFrame = frames.find((f) => f.event === 'citations');
    expect((citationsFrame?.data as { citations: unknown[] }).citations.length).toBeGreaterThan(0);

    const history = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/chat/sessions/${session.id}`,
    });
    expect(history.statusCode).toBe(200);
    const historyBody = history.json<{
      messages: { role: string; content: string }[];
    }>();
    expect(historyBody.messages).toHaveLength(2);
    expect(historyBody.messages[0]).toMatchObject({ role: 'user' });
    expect(historyBody.messages[1]).toMatchObject({ role: 'assistant', content: GENERATE_FIXTURE });
  });

  it('answers non-streaming when Accept is not text/event-stream', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/chat/sessions`,
      payload: {},
    });
    const session = sessionRes.json<{ id: string }>();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/chat/sessions/${session.id}/messages`,
      payload: { question: 'who calls verifyToken?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ content: string; citations: unknown[]; groundedContext: boolean }>();
    expect(body.content).toBe(GENERATE_FIXTURE);
    expect(body.groundedContext).toBe(true);
  });

  it('lists every session created for the repo', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/chat/sessions`,
      payload: { title: 'listed session' },
    });
    const session = sessionRes.json<{ id: string }>();

    const list = await app.inject({ method: 'GET', url: `/v1/repos/${repoId}/chat/sessions` });
    expect(list.statusCode).toBe(200);
    const sessions = list.json<{ id: string; title: string | null }[]>();
    expect(sessions.some((s) => s.id === session.id && s.title === 'listed session')).toBe(true);
  });

  it('returns a 404 problem+json for an unknown chat session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/chat/sessions/not-a-real-session-id`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('cancels the in-flight LLM call when the client disconnects mid-stream', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/v1/repos/${repoId}/chat/sessions`,
      payload: {},
    });
    const session = sessionRes.json<{ id: string }>();
    const requestsBefore = mockLlm.requests.length;

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/v1/repos/${repoId}/chat/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ question: 'who calls verifyToken?' }),
      signal: controller.signal,
    });

    const readPromise = readUntilTokenCount(res, 1).then((n) => {
      controller.abort();
      return n;
    });
    await expect(readPromise).resolves.toBeGreaterThanOrEqual(1);

    // The generate call was made (consuming an LLM request), but the stream
    // never reached its 'done' event — history shouldn't gain an assistant
    // turn for an answer that was never fully produced.
    expect(mockLlm.requests.length).toBeGreaterThan(requestsBefore);
    await new Promise((r) => setTimeout(r, 200)); // let the server finish unwinding
    const history = await app.inject({
      method: 'GET',
      url: `/v1/repos/${repoId}/chat/sessions/${session.id}`,
    });
    expect(history.json<{ messages: unknown[] }>().messages).toHaveLength(0);
  });
});
