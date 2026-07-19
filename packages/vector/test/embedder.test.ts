import { describe, expect, it } from 'vitest';
import { cosineSimilarity, createEmbedder, MockEmbedder } from '@twograph/vector';

const AUTH_A = 'export function verifyToken(token: string) { return validateJWT(token); }';
const AUTH_B = 'function authenticateUser(token) { if (!validateJWT(token)) throw new Error(); }';
const UNRELATED = 'const palette = ["red", "green", "blue"]; function paintCanvas(ctx) {}';

describe('MockEmbedder', () => {
  it('is deterministic for identical input', async () => {
    const embedder = new MockEmbedder();
    const [a] = await embedder.embed([AUTH_A]);
    const [b] = await embedder.embed([AUTH_A]);
    expect(a).toEqual(b);
  });

  it('similar code scores higher than unrelated code', async () => {
    const embedder = new MockEmbedder();
    const [a, b, c] = await embedder.embed([AUTH_A, AUTH_B, UNRELATED]);
    expect(cosineSimilarity(a!, b!)).toBeGreaterThan(cosineSimilarity(a!, c!));
  });

  it('handles batches of 64 with stable dimensions', async () => {
    const embedder = new MockEmbedder();
    const texts = Array.from(
      { length: 64 },
      (_, i) => `function f${String(i)}() { return ${String(i)}; }`,
    );
    const vectors = await embedder.embed(texts);
    expect(vectors).toHaveLength(64);
    expect(new Set(vectors.map((v) => v.length))).toEqual(new Set([embedder.dimensions]));
  });

  it('produces normalized vectors', async () => {
    const embedder = new MockEmbedder();
    const [v] = await embedder.embed([AUTH_A]);
    const norm = Math.sqrt(v!.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe('createEmbedder factory', () => {
  it('creates known providers and rejects unknown ones', () => {
    expect(createEmbedder('mock').id).toBe('mock');
    expect(createEmbedder('unixcoder-onnx').dimensions).toBe(768);
    expect(() => createEmbedder('nope')).toThrow(/unknown embedder/);
  });
});

// Real-model smoke test — requires network/model download; opt-in only.
describe.skipIf(!process.env['TWOGRAPH_TEST_REAL_EMBEDDER'])('TransformersEmbedder (real)', () => {
  it('embeds with the configured model', async () => {
    const embedder = createEmbedder('minilm');
    const [a, b, c] = await embedder.embed([AUTH_A, AUTH_B, UNRELATED]);
    expect(a).toHaveLength(embedder.dimensions);
    expect(cosineSimilarity(a!, b!)).toBeGreaterThan(cosineSimilarity(a!, c!));
  }, 300_000);
});
