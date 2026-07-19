import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { runIndex } from '../../src/commands/index-repo.js';
import { runSearch } from '../../src/commands/search.js';
import { repoIdFor } from '../../src/context.js';

const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';

function makeIo(): {
  io: { out(l: string): void; err(l: string): void };
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

function scaffoldRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'twograph-cli-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  // Mock embedder avoids a real model download; Memgraph/Qdrant defaults match docker-compose.
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({ embedder: { provider: 'mock' } }),
  );
  return root;
}

describe('twograph index + search (CLI wiring)', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (!root) return;
    const client = new GraphClient({ uri: MEMGRAPH });
    await client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: repoIdFor(root) });
    await client.close();
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('indexes a repo and reports a summary', async () => {
    root = scaffoldRepo();
    const { io, out } = makeIo();

    await runIndex(root, undefined, {}, io);

    expect(out.some((l) => /^indexed .* \+\d+ ~\d+ -\d+/.test(l))).toBe(true);
    expect(out.some((l) => l.includes('0 error(s)'))).toBe(true);
  }, 60_000);

  it('finds indexed symbols via semantic search, honoring filters', async () => {
    root = scaffoldRepo();
    const { io: indexIo } = makeIo();
    await runIndex(root, undefined, {}, indexIo);

    const { io, out } = makeIo();
    await runSearch(root, 'verify token signature', {}, io);
    expect(out.some((l) => l.startsWith('auth/jwt.ts'))).toBe(true);

    const { io: jsonIo, out: jsonOut } = makeIo();
    await runSearch(root, 'verify token signature', { json: true, k: '3' }, jsonIo);
    const parsed: unknown = JSON.parse(jsonOut.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBeLessThanOrEqual(3);

    const { io: filterIo, out: filterOut } = makeIo();
    await runSearch(root, 'verify token signature', { kind: 'interface' }, filterIo);
    const hitLines = filterOut.filter((l) => l.includes('score='));
    expect(hitLines.every((l) => l.includes('(interface)'))).toBe(true);
  }, 60_000);

  it('refuses an unimplemented search mode', async () => {
    root = scaffoldRepo();
    const { io } = makeIo();
    await expect(runSearch(root, 'anything', { mode: 'hybrid' }, io)).rejects.toThrow(
      /not implemented/,
    );
  });

  it('refuses to search a repo that has not been indexed', async () => {
    root = scaffoldRepo();
    const { io } = makeIo();
    await expect(runSearch(root, 'anything', {}, io)).rejects.toThrow(/run "twograph index"/);
  });
});
