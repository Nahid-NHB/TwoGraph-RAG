import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { ValidationError } from '@twograph/core';
import { runGraph } from '../../src/commands/graph.js';
import { runIndex } from '../../src/commands/index-repo.js';
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
  const root = mkdtempSync(join(tmpdir(), 'twograph-cli-graph-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({ embedder: { provider: 'mock' } }),
  );
  return root;
}

describe('twograph graph (CLI wiring, issue #75)', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (!root) return;
    const client = new GraphClient({ uri: MEMGRAPH });
    await client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: repoIdFor(root) });
    await client.close();
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('runs the who_calls template with --param name=... and returns rows as JSON', async () => {
    root = scaffoldRepo();
    const { io: indexIo } = makeIo();
    await runIndex(root, undefined, {}, indexIo);

    const { io, out } = makeIo();
    await runGraph(root, 'who_calls', { param: ['name=verifyToken'], json: true }, io);

    const rows = JSON.parse(out.join('\n')) as { name: string }[];
    expect(rows.some((r) => r.name === 'isAuthorized')).toBe(true);
  }, 60_000);

  it('rejects a malformed --param', async () => {
    root = scaffoldRepo();
    const { io: indexIo } = makeIo();
    await runIndex(root, undefined, {}, indexIo);

    const { io } = makeIo();
    await expect(runGraph(root, 'who_calls', { param: ['not-a-kv-pair'] }, io)).rejects.toThrow(
      ValidationError,
    );
  }, 60_000);
});
