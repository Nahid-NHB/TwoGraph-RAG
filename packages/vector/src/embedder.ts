import { createHash } from 'node:crypto';
import { EmbeddingError } from '@twograph/core';

/**
 * Embedding provider contract (docs/09 §2). The `id` namespaces the Qdrant
 * collection so switching models never mixes vector spaces.
 */
export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new EmbeddingError('dimension mismatch');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Deterministic, dependency-free embedder for tests and offline runs:
 * hashed bag-of-identifier-tokens, L2-normalized. Shared vocabulary between
 * two snippets yields higher cosine — enough signal for pipeline tests.
 */
export class MockEmbedder implements Embedder {
  readonly id = 'mock';
  readonly dimensions = 256;

  embed(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((t) => this.one(t)));
  }

  private one(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    const tokens = text.toLowerCase().match(/[a-z$_][a-z0-9$_]*/g) ?? [];
    for (const token of tokens) {
      const digest = createHash('sha1').update(token).digest();
      const index = digest.readUInt16BE(0) % this.dimensions;
      const sign = (digest[2] ?? 0) % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] ?? 0) / norm;
    return vector;
  }
}

/**
 * Local transformer embedder (UniXcoder-class models) running on ONNX via
 * transformers.js. Models download once into TWOGRAPH_MODEL_CACHE and are
 * checksummed by the runtime. Mean-pooled, normalized embeddings.
 */
export class TransformersEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;
  private readonly model: string;
  private pipe: ((texts: string[], opts: object) => Promise<{ tolist(): number[][] }>) | undefined;

  constructor(options: { id: string; model: string; dimensions: number }) {
    this.id = options.id;
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipe = await this.load();
    const results: Float32Array[] = [];
    const BATCH = 16;
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH).map((t) => t.slice(0, 4000));
      try {
        const output = await pipe(slice, { pooling: 'mean', normalize: true });
        for (const row of output.tolist()) results.push(Float32Array.from(row));
      } catch (err) {
        throw new EmbeddingError(`embedding batch failed (model ${this.model})`, { cause: err });
      }
    }
    return results;
  }

  private async load(): Promise<NonNullable<typeof this.pipe>> {
    if (this.pipe) return this.pipe;
    const { pipeline, env } = await import('@huggingface/transformers');
    const cacheDir = process.env['TWOGRAPH_MODEL_CACHE'];
    if (cacheDir) env.cacheDir = cacheDir;
    const pipe = (await pipeline('feature-extraction', this.model, {
      dtype: 'fp32',
    })) as unknown as NonNullable<typeof this.pipe>;
    this.pipe = pipe;
    return pipe;
  }
}

/** Factory keyed by config `embedder.provider`. */
export function createEmbedder(provider: string): Embedder {
  switch (provider) {
    case 'mock':
      return new MockEmbedder();
    case 'unixcoder-onnx':
      return new TransformersEmbedder({
        id: 'unixcoder-onnx',
        model: 'Xenova/unixcoder-base',
        dimensions: 768,
      });
    case 'minilm':
      return new TransformersEmbedder({
        id: 'minilm',
        model: 'Xenova/all-MiniLM-L6-v2',
        dimensions: 384,
      });
    default:
      throw new EmbeddingError(`unknown embedder provider: ${provider}`);
  }
}
