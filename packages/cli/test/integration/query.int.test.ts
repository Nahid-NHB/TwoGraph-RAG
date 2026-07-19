import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MetadataStore, openDatabase } from '@twograph/store';
import { runIndex } from '../../src/commands/index-repo.js';
import { runQuery } from '../../src/commands/query.js';
import { repoIdFor } from '../../src/context.js';

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
  const root = mkdtempSync(join(tmpdir(), 'twograph-cli-query-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({ embedder: { provider: 'mock' }, llm: { provider: 'mock', model: 'mock' } }),
  );
  return root;
}

describe('twograph query (CLI wiring)', () => {
  let root: string | undefined;

  afterEach(() => {
    if (!root) return;
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('answers over an indexed repo and persists the conversation to an implicit session', async () => {
    root = scaffoldRepo();
    await runIndex(root, undefined, {}, makeIo().io);

    const { io: io1, out: out1 } = makeIo();
    await runQuery(root, 'who calls verifyToken', {}, io1);
    expect(out1[0]?.length).toBeGreaterThan(0);

    const { io: io2, out: out2 } = makeIo();
    await runQuery(root, 'what does it call?', {}, io2);
    expect(out2[0]?.length).toBeGreaterThan(0);

    const db = openDatabase(join(root, '.twograph', 'store.db'));
    const store = new MetadataStore(db);
    const repoId = repoIdFor(root);

    const sessions = store.listChatSessions(repoId);
    expect(sessions).toHaveLength(1);

    const messages = store.listChatMessages(sessions[0]!.id);
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0]).toMatchObject({ content: 'who calls verifyToken' });
    expect(messages[2]).toMatchObject({ content: 'what does it call?' });
  }, 60_000);

  it('renders JSON output containing content, citations, and session id', async () => {
    root = scaffoldRepo();
    await runIndex(root, undefined, {}, makeIo().io);

    const { io, out } = makeIo();
    await runQuery(root, 'who calls verifyToken', { json: true }, io);

    const parsed = JSON.parse(out.join('')) as {
      content: unknown;
      citations: unknown;
      sessionId: unknown;
      standaloneQuestion: unknown;
    };
    expect(typeof parsed.content).toBe('string');
    expect(Array.isArray(parsed.citations)).toBe(true);
    expect(typeof parsed.sessionId).toBe('string');
    expect(typeof parsed.standaloneQuestion).toBe('string');
  }, 60_000);

  it('refuses to query a repo that has not been indexed', async () => {
    root = scaffoldRepo();
    const { io } = makeIo();
    await expect(runQuery(root, 'anything', {}, io)).rejects.toThrow(/run "twograph index"/);
  });
});
