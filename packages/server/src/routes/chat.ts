import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { citationSchema, NotFoundError, type Citation } from '@twograph/core';
import { askInSession, type RagPipelineDeps, type RagPipelineOptions } from '@twograph/rag';
import { Bm25Retriever, VectorRetriever } from '@twograph/retrieval';
import type { ChatSessionRow } from '@twograph/store';
import type { RegisteredRepo, RepoRegistry } from '../registry.js';

const createSessionBodySchema = z.object({ title: z.string().min(1).optional() });

const sessionSummarySchema = z.object({
  id: z.string(),
  repoId: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
});

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(citationSchema),
});

const sessionHistorySchema = sessionSummarySchema.extend({
  messages: z.array(chatMessageSchema),
});

const askBodySchema = z.object({ question: z.string().min(1) });

const chatAnswerSchema = z.object({
  sessionId: z.string(),
  standaloneQuestion: z.string(),
  content: z.string(),
  citations: z.array(citationSchema),
  groundedContext: z.boolean(),
});

function toSessionSummary(row: ChatSessionRow): z.infer<typeof sessionSummarySchema> {
  return { id: row.id, repoId: row.repo_id, title: row.title, createdAt: row.created_at };
}

/** @throws NotFoundError if the session doesn't exist or belongs to a different repo. */
function requireSession(repo: RegisteredRepo, sessionId: string): ChatSessionRow {
  const session = repo.store.getChatSession(sessionId);
  if (!session || session.repo_id !== repo.id) {
    throw new NotFoundError(`chat session not found: ${sessionId}`);
  }
  return session;
}

function pipelineDeps(repo: RegisteredRepo): RagPipelineDeps {
  return {
    bm25: new Bm25Retriever(repo.fts, repo.id),
    vector: new VectorRetriever(
      { store: repo.store, vectors: repo.vectors, embedder: repo.embedder },
      repo.id,
    ),
    graphQueries: repo.graphQueries,
    reranker: repo.reranker,
    llm: repo.llm,
    store: repo.store,
    readSpan: (path, startLine, endLine) =>
      readFileSync(join(repo.rootPath, path), 'utf8')
        .split('\n')
        .slice(startLine - 1, endLine)
        .join('\n'),
  };
}

function pipelineOptions(repo: RegisteredRepo): RagPipelineOptions {
  return {
    repo: repo.id,
    rerankEnabled: repo.config.retrieval.rerank,
    tokenBudget: repo.config.retrieval.contextTokenBudget,
  };
}

/** Sent periodically so intermediaries (proxies, load balancers) don't time out the connection. */
const HEARTBEAT_MS = 15_000;

function writeSseEvent(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Streams `stage`/`token`/`citations`/`done`/`error` SSE events for a chat
 * turn (issue #47, docs/06 §Chat). The response is hijacked from Fastify's
 * normal send pipeline so raw frames can be written as the pipeline
 * progresses. A client disconnect aborts the signal threaded through the
 * whole RAG pipeline, cancelling the in-flight LLM call rather than letting
 * it run to completion unobserved. This listens on `reply.raw` (the response
 * socket), not `request.raw` (the request) — the request's `close` event
 * fires as soon as its (already-buffered) body finishes being read, long
 * before the response is done, which would abort every request instantly.
 */
async function streamAnswer(
  repo: RegisteredRepo,
  reply: FastifyReply,
  sessionId: string,
  question: string,
): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const controller = new AbortController();
  let finished = false;
  reply.raw.on('close', () => {
    if (!finished) controller.abort();
  });

  const heartbeat = setInterval(() => {
    if (!finished) reply.raw.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  try {
    const result = await askInSession(
      { store: repo.store, pipeline: pipelineDeps(repo) },
      sessionId,
      question,
      {
        ...pipelineOptions(repo),
        signal: controller.signal,
        onStage: (stage) => writeSseEvent(reply, 'stage', { stage }),
        onToken: (delta) => writeSseEvent(reply, 'token', { delta }),
      },
    );
    writeSseEvent(reply, 'citations', { citations: result.citations });
    writeSseEvent(reply, 'done', { usage: result.usage, groundedContext: result.groundedContext });
  } catch (err) {
    // A client-initiated abort means nobody's listening — skip the error
    // frame rather than writing to a socket the client already closed.
    if (!controller.signal.aborted) {
      const message = err instanceof Error ? err.message : 'stream failed';
      writeSseEvent(reply, 'error', { message });
    }
  } finally {
    finished = true;
    clearInterval(heartbeat);
    reply.raw.end();
  }
}

/** `/v1/repos/:repo/chat/sessions[...]` — grounded RAG chat with SSE streaming (issue #47). */
export function registerChatRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos/:repo/chat/sessions',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        body: createSessionBodySchema,
        response: { 201: sessionSummarySchema },
      },
    },
    (request, reply) => {
      const repo = registry.require(request.params.repo);
      const session = repo.store.createChatSession(repo.id, request.body.title);
      void reply.code(201);
      return toSessionSummary(session);
    },
  );

  server.get(
    '/v1/repos/:repo/chat/sessions/:sid',
    {
      schema: {
        params: z.object({ repo: z.string(), sid: z.string() }),
        response: { 200: sessionHistorySchema },
      },
    },
    (request) => {
      const repo = registry.require(request.params.repo);
      const session = requireSession(repo, request.params.sid);
      const messages = repo.store.listChatMessages(session.id).map((m) => ({
        role: m.role,
        content: m.content,
        citations: m.citations_json ? (JSON.parse(m.citations_json) as Citation[]) : [],
      }));
      return { ...toSessionSummary(session), messages };
    },
  );

  server.post(
    '/v1/repos/:repo/chat/sessions/:sid/messages',
    {
      schema: {
        params: z.object({ repo: z.string(), sid: z.string() }),
        body: askBodySchema,
        response: { 200: chatAnswerSchema },
      },
    },
    async (request, reply) => {
      const repo = registry.require(request.params.repo);
      const session = requireSession(repo, request.params.sid);

      if (request.headers.accept?.includes('text/event-stream')) {
        await streamAnswer(repo, reply, session.id, request.body.question);
        return reply;
      }

      const result = await askInSession(
        { store: repo.store, pipeline: pipelineDeps(repo) },
        session.id,
        request.body.question,
        pipelineOptions(repo),
      );
      return {
        sessionId: result.sessionId,
        standaloneQuestion: result.standaloneQuestion,
        content: result.content,
        citations: result.citations,
        groundedContext: result.groundedContext,
      };
    },
  );
}
