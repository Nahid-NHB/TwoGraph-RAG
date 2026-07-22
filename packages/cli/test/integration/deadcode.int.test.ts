import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { runDeadCode } from '../../src/commands/deadcode.js';
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
  const root = mkdtempSync(join(tmpdir(), 'twograph-cli-deadcode-'));
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

describe('twograph deadcode (CLI wiring)', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (!root) return;
    const client = new GraphClient({ uri: MEMGRAPH });
    await client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: repoIdFor(root) });
    await client.close();
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('reports the planted dead component as JSON', async () => {
    root = scaffoldRepo();
    const { io: indexIo } = makeIo();
    await runIndex(root, undefined, {}, indexIo);

    const { io, out } = makeIo();
    await runDeadCode(root, { json: true }, io);

    const report = JSON.parse(out.join('\n')) as { symbols: { name: string }[] };
    expect(report.symbols.map((s) => s.name)).toContain('DeadBanner');
  }, 60_000);
});
