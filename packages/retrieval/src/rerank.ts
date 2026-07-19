import { EmbeddingError, type RankedHit } from '@twograph/core';

export interface RerankCandidate {
  hit: RankedHit;
  content: string;
}

/**
 * Cross-encoder contract: scores (query, chunk) pairs directly, unlike the
 * bi-encoder vector retriever. Reorders the input; never invents new hits.
 */
export interface Reranker {
  readonly id: string;
  rerank(query: string, candidates: RerankCandidate[], k?: number): Promise<RankedHit[]>;
}

/**
 * Deterministic, dependency-free reranker for tests and offline runs: scores
 * pairs by query/content token overlap. Enough signal to prove the mechanism
 * (a candidate with weak fused rank but strong lexical overlap gets promoted)
 * without a model download.
 */
export class MockReranker implements Reranker {
  readonly id = 'mock';

  rerank(query: string, candidates: RerankCandidate[], k?: number): Promise<RankedHit[]> {
    const queryTokens = new Set(tokenize(query));
    const scored = candidates.map((c) => ({
      ...c.hit,
      score: overlapCount(queryTokens, tokenize(c.content)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return Promise.resolve(k === undefined ? scored : scored.slice(0, k));
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z$_][a-z0-9$_]*/g) ?? [];
}

function overlapCount(queryTokens: Set<string>, contentTokens: string[]): number {
  const contentSet = new Set(contentTokens);
  let count = 0;
  for (const t of queryTokens) if (contentSet.has(t)) count += 1;
  return count;
}

type SequenceClassificationModel = (
  inputs: unknown,
) => Promise<{ logits: { tolist(): number[][] } }>;
type Tokenizer = (
  texts: string[],
  options: { text_pair: string[]; padding: boolean; truncation: boolean },
) => unknown;

/**
 * ms-marco-MiniLM-class cross-encoder on ONNX (transformers.js). Reranks the
 * top fused candidates before context assembly (docs/07 §5); optional per
 * `config.retrieval.rerank` via {@link maybeRerank}.
 */
export class CrossEncoderReranker implements Reranker {
  readonly id: string;
  private readonly model: string;
  private loaded: { tokenizer: Tokenizer; model: SequenceClassificationModel } | undefined;

  constructor(options: { id?: string; model?: string } = {}) {
    this.id = options.id ?? 'ms-marco-minilm';
    this.model = options.model ?? 'Xenova/ms-marco-MiniLM-L-6-v2';
  }

  async rerank(query: string, candidates: RerankCandidate[], k?: number): Promise<RankedHit[]> {
    if (candidates.length === 0) return [];
    const { tokenizer, model } = await this.load();
    let scores: number[];
    try {
      const inputs = tokenizer(
        candidates.map(() => query),
        {
          text_pair: candidates.map((c) => c.content.slice(0, 2000)),
          padding: true,
          truncation: true,
        },
      );
      const { logits } = await model(inputs);
      scores = logits.tolist().map((row) => row[0] ?? -Infinity);
    } catch (err) {
      throw new EmbeddingError(`reranking failed (model ${this.model})`, { cause: err });
    }
    const scored = candidates.map((c, i) => ({ ...c.hit, score: scores[i] ?? -Infinity }));
    scored.sort((a, b) => b.score - a.score);
    return k === undefined ? scored : scored.slice(0, k);
  }

  private async load(): Promise<NonNullable<typeof this.loaded>> {
    if (this.loaded) return this.loaded;
    const { AutoTokenizer, AutoModelForSequenceClassification, env } =
      await import('@huggingface/transformers');
    const cacheDir = process.env['TWOGRAPH_MODEL_CACHE'];
    if (cacheDir) env.cacheDir = cacheDir;
    const tokenizer = (await AutoTokenizer.from_pretrained(this.model)) as unknown as Tokenizer;
    const model = (await AutoModelForSequenceClassification.from_pretrained(
      this.model,
    )) as unknown as SequenceClassificationModel;
    this.loaded = { tokenizer, model };
    return this.loaded;
  }
}

/**
 * Applies reranking only when enabled (`config.retrieval.rerank`); otherwise
 * passes the fused order through untouched, truncated to k. This is the
 * "disabled cleanly via config" path from issue #38's acceptance criteria.
 */
export function maybeRerank(
  enabled: boolean,
  reranker: Reranker,
  query: string,
  candidates: RerankCandidate[],
  k?: number,
): Promise<RankedHit[]> {
  if (!enabled) {
    const hits = candidates.map((c) => c.hit);
    return Promise.resolve(k === undefined ? hits : hits.slice(0, k));
  }
  return reranker.rerank(query, candidates, k);
}
