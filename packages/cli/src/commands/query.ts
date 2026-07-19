import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GraphError, type Citation, ValidationError } from '@twograph/core';
import { createLlmProvider } from '@twograph/llm';
import { askInSession, type AskInSessionResult } from '@twograph/rag';
import { Bm25Retriever, CrossEncoderReranker, VectorRetriever } from '@twograph/retrieval';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface QueryCommandOptions {
  json?: boolean;
}

/** Formats a citation as `path:startLine-endLine` — issue #45's CLI acceptance criterion. */
export function formatCitation(citation: Citation): string {
  return `${citation.file}:${String(citation.startLine)}-${String(citation.endLine)}`;
}

/** Renders a RAG answer as plain text (used by the non-JSON CLI output path). */
export function renderAnswer(
  io: ProgramIo,
  result: Pick<AskInSessionResult, 'content' | 'citations'>,
): void {
  io.out(result.content);
  if (result.citations.length > 0) {
    io.out('');
    io.out('Sources:');
    for (const citation of result.citations) io.out(`  ${formatCitation(citation)}`);
  }
}

/** `twograph query "<question>"` — issue #45: grounded RAG with an implicit, persisted session. */
export async function runQuery(
  cwd: string,
  question: string,
  options: QueryCommandOptions,
  io: ProgramIo,
): Promise<void> {
  const root = resolveRepoRoot(undefined, cwd);
  const ctx = openRepoContext(root);
  try {
    if (!ctx.store.getRepository(ctx.repo.id)) {
      throw new ValidationError(`no index found for ${root} — run "twograph index" first`);
    }
    if (!(await ctx.graphClient.healthcheck())) {
      throw new GraphError(
        'GRAPH_UNAVAILABLE',
        `Memgraph unreachable at ${ctx.config.memgraph.uri}`,
      );
    }

    const llm = createLlmProvider(ctx.config);
    const session = ctx.store.getOrCreateImplicitSession(ctx.repo.id);

    const result = await askInSession(
      {
        store: ctx.store,
        pipeline: {
          bm25: new Bm25Retriever(ctx.fts, ctx.repo.id),
          vector: new VectorRetriever(
            { store: ctx.store, vectors: ctx.vectors, embedder: ctx.embedder },
            ctx.repo.id,
          ),
          graphQueries: ctx.graphQueries,
          reranker: new CrossEncoderReranker(),
          store: ctx.store,
          llm,
          readSpan: (path, startLine, endLine) =>
            readFileSync(join(root, path), 'utf8')
              .split('\n')
              .slice(startLine - 1, endLine)
              .join('\n'),
        },
      },
      session.id,
      question,
      {
        repo: ctx.repo.id,
        rerankEnabled: ctx.config.retrieval.rerank,
        tokenBudget: ctx.config.retrieval.contextTokenBudget,
      },
    );

    if (options.json) {
      io.out(JSON.stringify(result, null, 2));
      return;
    }

    renderAnswer(io, result);
  } finally {
    await ctx.close();
  }
}
