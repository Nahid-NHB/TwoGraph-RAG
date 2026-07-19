import { describe, expect, it } from 'vitest';
import { openDatabase, MetadataStore } from '@twograph/store';
import { assembleContext, heuristicTokenCount, type ContextGraphSource } from '@twograph/retrieval';

const REPO = 'r';

function seedStore(): MetadataStore {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO repositories (id, root_path, name) VALUES ('r', '/tmp/r', 'r')`);
  db.exec(
    `INSERT INTO files (id, repo_id, rel_path, language, content_hash, size_bytes)
     VALUES ('r:auth/jwt.ts', 'r', 'auth/jwt.ts', 'ts', 'h1', 500),
            ('r:api/handlers.ts', 'r', 'api/handlers.ts', 'ts', 'h2', 500)`,
  );
  db.exec(
    `INSERT INTO symbols (id, file_id, repo_id, kind, name, qualified, signature, doc,
                           start_line, end_line, exported, content_hash)
     VALUES
      ('r:auth/jwt.ts#verifyToken', 'r:auth/jwt.ts', 'r', 'function', 'verifyToken', 'verifyToken',
       'function verifyToken(token: string): TokenPayload',
       'Verifies a JWT-shaped token and returns its payload.', 10, 12, 1, 'h3'),
      ('r:auth/jwt.ts#decodeToken', 'r:auth/jwt.ts', 'r', 'function', 'decodeToken', 'decodeToken',
       'function decodeToken(token: string): TokenPayload', NULL, 20, 22, 0, 'h4'),
      ('r:auth/jwt.ts#validateJWT', 'r:auth/jwt.ts', 'r', 'function', 'validateJWT', 'validateJWT',
       'function validateJWT(token: string): boolean', NULL, 24, 26, 1, 'h5'),
      ('r:api/handlers.ts#isAuthorized', 'r:api/handlers.ts', 'r', 'function', 'isAuthorized',
       'isAuthorized', 'function isAuthorized(header: string): boolean', NULL, 40, 42, 0, 'h6')`,
  );
  return new MetadataStore(db);
}

function fakeGraph(): ContextGraphSource {
  return {
    callers: (_repo, symbolId) =>
      Promise.resolve(
        symbolId === 'r:auth/jwt.ts#verifyToken'
          ? [
              {
                id: 'r:api/handlers.ts#isAuthorized',
                name: 'isAuthorized',
                kind: 'function',
                path: 'api/handlers.ts',
                depth: 1,
              },
            ]
          : [],
      ),
    callees: (_repo, symbolId) =>
      Promise.resolve(
        symbolId === 'r:auth/jwt.ts#verifyToken'
          ? [
              {
                id: 'r:auth/jwt.ts#decodeToken',
                name: 'decodeToken',
                kind: 'function',
                path: 'auth/jwt.ts',
                depth: 1,
              },
              {
                id: 'r:auth/jwt.ts#validateJWT',
                name: 'validateJWT',
                kind: 'function',
                path: 'auth/jwt.ts',
                depth: 1,
              },
            ]
          : [],
      ),
    filePaths: () => Promise.resolve(['auth/jwt.ts', 'auth/types.ts', 'api/handlers.ts']),
    neighbors: (_repo, fileId) =>
      Promise.resolve({
        outgoing:
          fileId === 'r:auth/jwt.ts'
            ? [
                {
                  id: 'r:auth/types.ts',
                  name: 'types.ts',
                  kind: 'File',
                  path: 'auth/types.ts',
                  edge: 'IMPORTS',
                },
              ]
            : [],
        incoming: [],
      }),
  };
}

const SOURCE: Record<string, string> = {
  'auth/jwt.ts': [
    'export function verifyToken(token: string): TokenPayload {',
    '  return decodeToken(token);',
    '}',
  ].join('\n'),
};

function readSpan(path: string): string {
  return SOURCE[path] ?? '';
}

describe('assembleContext', () => {
  it('produces the expected block layout (snapshot)', async () => {
    const result = await assembleContext(
      { store: seedStore(), graph: fakeGraph(), readSpan },
      REPO,
      ['r:auth/jwt.ts#verifyToken'],
    );

    expect(result.blocks).toMatchSnapshot();
    expect(result.truncated).toBe(false);
  });

  it('respects the token budget exactly, never overshooting', async () => {
    const store = seedStore();
    const graph = fakeGraph();
    const symbolIds = [
      'r:auth/jwt.ts#verifyToken',
      'r:auth/jwt.ts#decodeToken',
      'r:auth/jwt.ts#validateJWT',
      'r:api/handlers.ts#isAuthorized',
    ];

    const result = await assembleContext({ store, graph, readSpan }, REPO, symbolIds, {
      tokenBudget: 40,
    });

    expect(result.totalTokens).toBeLessThanOrEqual(40);
    expect(result.truncated).toBe(true);
    expect(result.blocks.length).toBeLessThan(symbolIds.length);
  });

  it('never duplicates the same file span across blocks', async () => {
    const store = seedStore();
    const graph = fakeGraph();
    // Same symbol requested twice (e.g. it surfaced via two retrievers pre-fusion).
    const result = await assembleContext({ store, graph, readSpan }, REPO, [
      'r:auth/jwt.ts#verifyToken',
      'r:auth/jwt.ts#verifyToken',
    ]);

    const codeOccurrences = result.blocks.filter((b) =>
      b.text.includes('return decodeToken(token);'),
    );
    expect(codeOccurrences).toHaveLength(1);
  });

  it('renders caller/callee sections as signatures only, not full bodies', async () => {
    const result = await assembleContext(
      { store: seedStore(), graph: fakeGraph(), readSpan },
      REPO,
      ['r:auth/jwt.ts#verifyToken'],
    );

    const text = result.blocks[0]?.text ?? '';
    expect(text).toContain('Callers:');
    expect(text).toContain(
      'isAuthorized (api/handlers.ts): function isAuthorized(header: string): boolean',
    );
    expect(text).toContain('Callees:');
    expect(text).toContain(
      'decodeToken (auth/jwt.ts): function decodeToken(token: string): TokenPayload',
    );
    // The callee's own body is never inlined — only its signature appears.
    expect(text.match(/function decodeToken/g)).toHaveLength(1);
  });

  it('skips unknown symbol ids without failing the whole assembly', async () => {
    const result = await assembleContext(
      { store: seedStore(), graph: fakeGraph(), readSpan },
      REPO,
      ['r:does-not-exist.ts#ghost', 'r:auth/jwt.ts#verifyToken'],
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.symbolId).toBe('r:auth/jwt.ts#verifyToken');
  });
});

describe('heuristicTokenCount', () => {
  it('approximates ~4 chars per token', () => {
    expect(heuristicTokenCount('a'.repeat(400))).toBe(100);
  });
});
