import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockEmbedder, QdrantVectorStore, type VectorPoint } from '@twograph/vector';

const URL = process.env['QDRANT_URL'] ?? 'http://localhost:6333';
const embedder = new MockEmbedder();
const store = new QdrantVectorStore({
  url: URL,
  embedderId: 'mock-int',
  dimensions: embedder.dimensions,
});
const REPO = 'vtest';

const CODE = {
  verifyToken: 'export function verifyToken(token) { return validateJWT(token); }',
  paintCanvas: 'function paintCanvas(ctx) { ctx.fillStyle = "red"; }',
  loginForm:
    'function LoginForm() { const auth = useAuth(); return <form onSubmit={auth.login} />; }',
};

async function point(
  chunkId: string,
  code: string,
  payload: Partial<VectorPoint['payload']> = {},
): Promise<VectorPoint> {
  const [vector] = await embedder.embed([code]);
  return {
    chunkId,
    symbolId: chunkId,
    repo: REPO,
    vector: vector!,
    payload: {
      kind: 'function',
      path: 'src/misc.ts',
      language: 'typescript',
      name: chunkId.split('#')[1] ?? chunkId,
      exported: true,
      ...payload,
    },
  };
}

beforeAll(async () => {
  await store.ensureCollection();
  await store.ensureCollection(); // idempotent
  await store.deleteByRepo(REPO);
  await store.upsert([
    await point(`${REPO}:src/auth/jwt.ts#verifyToken`, CODE.verifyToken, {
      path: 'src/auth/jwt.ts',
    }),
    await point(`${REPO}:src/draw.ts#paintCanvas`, CODE.paintCanvas, {
      path: 'src/draw.ts',
    }),
    await point(`${REPO}:src/auth/LoginForm.tsx#LoginForm`, CODE.loginForm, {
      path: 'src/auth/LoginForm.tsx',
      kind: 'component',
      language: 'tsx',
    }),
  ]);
}, 60_000);

afterAll(async () => {
  await store.deleteByRepo(REPO);
});

describe('QdrantVectorStore', () => {
  it('nearest-neighbor search surfaces semantically closer code', async () => {
    const [query] = await embedder.embed(['function checkToken(token) { validateJWT(token); }']);
    const hits = await store.search(REPO, query!, 3);
    expect(hits[0]?.symbolId).toBe(`${REPO}:src/auth/jwt.ts#verifyToken`);
  });

  it('kind and path-subtree filters constrain results', async () => {
    const [query] = await embedder.embed(['auth login token form']);
    const components = await store.search(REPO, query!, 10, { kinds: ['component'] });
    expect(components.map((h) => h.kind)).toEqual(['component']);
    const authOnly = await store.search(REPO, query!, 10, { pathPrefix: 'src/auth' });
    expect(authOnly.every((h) => h.path.startsWith('src/auth/'))).toBe(true);
    expect(authOnly.length).toBe(2);
  });

  it('deleteBySymbolIds removes exactly the targeted points', async () => {
    await store.deleteBySymbolIds(REPO, [`${REPO}:src/draw.ts#paintCanvas`]);
    const [query] = await embedder.embed(['paint canvas red']);
    const hits = await store.search(REPO, query!, 10);
    expect(hits.some((h) => h.symbolId.includes('paintCanvas'))).toBe(false);
    expect(hits.length).toBe(2);
  });

  it('upserts are idempotent per chunk id', async () => {
    const p = await point(`${REPO}:src/auth/jwt.ts#verifyToken`, CODE.verifyToken, {
      path: 'src/auth/jwt.ts',
    });
    await store.upsert([p]);
    const [query] = await embedder.embed([CODE.verifyToken]);
    const hits = await store.search(REPO, query!, 10);
    expect(hits.filter((h) => h.symbolId.includes('verifyToken'))).toHaveLength(1);
  });
});
