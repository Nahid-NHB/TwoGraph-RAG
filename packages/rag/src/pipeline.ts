import { createLogger, type Citation, type RankedHit } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';
import type { CompletionResult, LlmProvider, Usage } from '@twograph/llm';
import {
  assembleContext,
  expandSeeds,
  fuseRankedLists,
  GraphRetriever,
  maybeRerank,
  type ContextBlock,
  type Reranker,
  type RerankCandidate,
  type Retriever,
} from '@twograph/retrieval';
import type { MetadataStore } from '@twograph/store';
import { generateMultiQuery, type MultiQueryResult } from './multiquery.js';

const log = createLogger('rag:pipeline');

const NOT_ENOUGH_CONTEXT = 'Not enough context to answer this question.';

const GROUNDING_SYSTEM_PROMPT = `You are a code assistant answering questions about a specific repository using ONLY the numbered context blocks provided below.

Rules:
- Answer strictly from the given context. Never use outside knowledge or invent code that isn't shown.
- Cite every factual claim with the block it came from, in the exact form [S#] (e.g. [S1], [S2]) placed right after the claim.
- If the context does not contain enough information to answer, reply with exactly: "${NOT_ENOUGH_CONTEXT}"`;

export interface RagPipelineDeps {
  bm25: Retriever;
  vector: Retriever;
  graphQueries: GraphQueries;
  reranker: Reranker;
  llm: LlmProvider;
  store: MetadataStore;
  /** Reads exact source lines for a symbol's span — see @twograph/retrieval's context assembler. */
  readSpan(path: string, startLine: number, endLine: number): string;
}

export interface RagPipelineOptions {
  repo: string;
  /** Whether to run the cross-encoder rerank stage — mirrors config.retrieval.rerank. Default true. */
  rerankEnabled?: boolean;
  /** Context assembler token budget. Default 12,000. */
  tokenBudget?: number;
  /** Hits requested per retriever per generated query. Default 20. */
  topKPerRetriever?: number;
  /** BM25+vector seeds expanded across the graph. Default 10. */
  topSeedsForExpansion?: number;
  /** Fused candidates passed into reranking. Default 50. */
  topCandidatesForRerank?: number;
  /** Reranked symbols that make it into the assembled context. Default 8. */
  topSymbolsForContext?: number;
  /** Called at the start of each stage — drives SSE `stage` progress events (issue #47). */
  onStage?: (stage: string) => void;
  /** When set, the generate stage streams via `llm.stream()` instead of `llm.complete()`,
   * invoking this per text delta — drives SSE `token` events (issue #47). */
  onToken?: (delta: string) => void;
  /** Propagated into every LLM call; aborting cancels the in-flight LLM request (issue #47). */
  signal?: AbortSignal;
}

export interface RagAnswer {
  /** Raw answer text, `[S#]` markers intact for the caller to render as links. */
  content: string;
  citations: Citation[];
  /** False when no context blocks were assembled — the LLM was never called. */
  groundedContext: boolean;
  multiQuery: MultiQueryResult;
  usage: Usage;
  /** Wall-clock ms per stage, for the timing-spans requirement (docs NFR-11). */
  stageTimings: Record<string, number>;
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

async function timed<T>(
  timings: Record<string, number>,
  stage: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const result = await fn();
  const ms = performance.now() - started;
  timings[stage] = ms;
  log.info({ stage, ms: Math.round(ms) }, 'rag stage complete');
  return result;
}

/** Drains `llm.stream()`, forwarding each text delta to `onToken`, and returns the final result. */
async function streamCompletion(
  llm: LlmProvider,
  messages: { role: 'system' | 'user'; content: string }[],
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<CompletionResult> {
  let result: CompletionResult | undefined;
  for await (const event of llm.stream({ messages, ...(signal ? { signal } : {}) })) {
    if (event.type === 'text-delta') onToken(event.delta);
    else if (event.type === 'done') result = event.result;
  }
  if (!result) throw new Error('llm.stream() ended without a done event');
  return result;
}

function hydrateForRerank(store: MetadataStore, hits: RankedHit[]): RerankCandidate[] {
  const chunks = store.chunksByIds(hits.map((h) => h.symbolId));
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return hits.map((hit) => ({ hit, content: byId.get(hit.symbolId)?.content ?? '' }));
}

function extractCitations(
  answer: string,
  blocks: ContextBlock[],
  graphPathBySymbol: Map<string, string>,
): Citation[] {
  const byCitationId = new Map(blocks.map((b) => [b.citationId, b]));
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const match of answer.matchAll(/\[S(\d+)\]/g)) {
    const citationId = `S${match[1] ?? ''}`;
    if (seen.has(citationId)) continue;
    const block = byCitationId.get(citationId);
    if (!block) continue;
    seen.add(citationId);
    const graphPath = graphPathBySymbol.get(block.symbolId);
    citations.push({
      file: block.path,
      symbolId: block.symbolId,
      startLine: block.startLine,
      endLine: block.endLine,
      ...(graphPath ? { graphPath } : {}),
    });
  }
  return citations;
}

/**
 * Full grounded RAG pipeline (issue #44, docs/07): multi-query → retrievers
 * (BM25 ∥ vector ∥ graph) → graph expansion of BM25/vector seeds → RRF →
 * rerank → token-budgeted context assembly → grounded generation with
 * `[S#]` citations. Returns "not enough context" (no LLM call) when nothing
 * assembles; per-stage wall-clock timings are logged and returned.
 */
export async function runRagPipeline(
  deps: RagPipelineDeps,
  question: string,
  options: RagPipelineOptions,
): Promise<RagAnswer> {
  const stageTimings: Record<string, number> = {};
  const repo = options.repo;
  const k = options.topKPerRetriever ?? 20;
  const graphPathBySymbol = new Map<string, string>();

  options.onStage?.('multiquery');
  const multiQuery = await timed(stageTimings, 'multiquery', () =>
    generateMultiQuery(deps.llm, question, options.signal),
  );

  options.onStage?.('retrieve');
  const { bm25Lists, vectorLists, graphHits } = await timed(stageTimings, 'retrieve', async () => {
    const graphRetriever = new GraphRetriever(deps.graphQueries, repo);
    const bm25: RankedHit[][] = [];
    const vector: RankedHit[][] = [];
    for (const q of multiQuery.queries) {
      const [bm25Hits, vectorHits] = await Promise.all([
        deps.bm25.retrieve(q, { k }),
        deps.vector.retrieve(q, { k }),
      ]);
      bm25.push(bm25Hits);
      vector.push(vectorHits);
    }
    const graph = await graphRetriever.retrieve(question, { k });
    return { bm25Lists: bm25, vectorLists: vector, graphHits: graph };
  });
  for (const hit of graphHits)
    if (hit.graphPath) graphPathBySymbol.set(hit.symbolId, hit.graphPath);

  options.onStage?.('expand');
  const expansionHits = await timed(stageTimings, 'expand', async () => {
    const seeds = [...bm25Lists.flat(), ...vectorLists.flat()].sort((a, b) => b.score - a.score);
    const expanded = await expandSeeds(deps.graphQueries, repo, seeds, {
      topSeeds: options.topSeedsForExpansion ?? 10,
    });
    for (const hit of expanded)
      if (hit.graphPath) graphPathBySymbol.set(hit.symbolId, hit.graphPath);
    return expanded;
  });

  options.onStage?.('fuse');
  const fused = await timed(stageTimings, 'fuse', () =>
    Promise.resolve(fuseRankedLists([...bm25Lists, ...vectorLists, graphHits, expansionHits])),
  );

  options.onStage?.('rerank');
  const reranked = await timed(stageTimings, 'rerank', () => {
    const candidates = hydrateForRerank(
      deps.store,
      fused.slice(0, options.topCandidatesForRerank ?? 50),
    );
    return maybeRerank(options.rerankEnabled ?? true, deps.reranker, question, candidates);
  });

  const topSymbolIds = reranked.slice(0, options.topSymbolsForContext ?? 8).map((h) => h.symbolId);

  options.onStage?.('assemble');
  const assembled = await timed(stageTimings, 'assemble', () =>
    assembleContext(
      {
        store: deps.store,
        graph: deps.graphQueries,
        readSpan: (path, startLine, endLine) => deps.readSpan(path, startLine, endLine),
      },
      repo,
      topSymbolIds,
      options.tokenBudget !== undefined ? { tokenBudget: options.tokenBudget } : {},
    ),
  );

  if (assembled.blocks.length === 0) {
    return {
      content: NOT_ENOUGH_CONTEXT,
      citations: [],
      groundedContext: false,
      multiQuery,
      usage: ZERO_USAGE,
      stageTimings,
    };
  }

  const contextText = assembled.blocks.map((b) => b.text).join('\n\n---\n\n');
  const generateMessages = [
    { role: 'system' as const, content: GROUNDING_SYSTEM_PROMPT },
    { role: 'user' as const, content: `Context:\n${contextText}\n\nQuestion: ${question}` },
  ];

  options.onStage?.('generate');
  const completion = await timed(stageTimings, 'generate', () =>
    options.onToken
      ? streamCompletion(deps.llm, generateMessages, options.onToken, options.signal)
      : deps.llm.complete({
          messages: generateMessages,
          ...(options.signal ? { signal: options.signal } : {}),
        }),
  );

  return {
    content: completion.content,
    citations: extractCitations(completion.content, assembled.blocks, graphPathBySymbol),
    groundedContext: true,
    multiQuery,
    usage: completion.usage,
    stageTimings,
  };
}
