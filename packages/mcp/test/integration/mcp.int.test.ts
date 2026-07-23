import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Indexer } from '@twograph/indexer';
import { buildMcpServer } from '../../src/server.js';
import { openRepoContext, type RepoContext } from '../../src/context.js';
import { startHttpServer } from '../../src/runtime.js';

let root: string;
let ctx: RepoContext;

async function callToolJson(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBeFalsy();
  const content = result.content as { type: string; text: string }[];
  const text = content[0]?.text;
  if (!text) throw new Error(`tool ${name} returned no text content`);
  return JSON.parse(text) as unknown;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'twograph-mcp-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(
    join(root, '.twograph', 'config.json'),
    JSON.stringify({ embedder: { provider: 'mock' }, llm: { provider: 'mock', model: 'mock' } }),
  );

  ctx = openRepoContext(root);
  await ctx.vectors.ensureCollection();
  const indexer = new Indexer({
    repo: ctx.repo,
    graphClient: ctx.graphClient,
    store: ctx.store,
    fts: ctx.fts,
    vectors: ctx.vectors,
    embedder: ctx.embedder,
    ignore: ctx.config.index.ignore,
  });
  await indexer.run({ rebuild: true });
}, 60_000);

afterAll(async () => {
  await ctx.close();
  rmSync(root, { recursive: true, force: true });
});

describe('@twograph/mcp read + editing tools', () => {
  it('returns structured results from all three read tools over an in-memory transport', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'repository_summary',
        'semantic_search',
        'query_graph',
        'call_hierarchy',
        'component_usage',
        'dependency_graph',
        'dead_code',
        'edit_function',
        'optimize_function',
      ]),
    );

    const summary = (await callToolJson(client, 'repository_summary', { repo: root })) as {
      fileCount: number;
      languages: Record<string, number>;
    };
    expect(summary.fileCount).toBeGreaterThan(0);
    expect(Object.keys(summary.languages).length).toBeGreaterThan(0);

    const hits = (await callToolJson(client, 'semantic_search', {
      repo: root,
      query: 'verify a json web token',
      k: 5,
    })) as unknown[];
    expect(Array.isArray(hits)).toBe(true);

    const rows = await callToolJson(client, 'query_graph', {
      repo: root,
      template: 'unused_components',
      params: {},
    });
    expect(Array.isArray(rows)).toBe(true);

    await client.close();
  }, 30_000);

  it('returns structured, truncated results from the four analysis tools (issue #64)', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const callers = (await callToolJson(client, 'call_hierarchy', {
      repo: root,
      symbolId: `${ctx.repo.id}:auth/jwt.ts#verifyToken`,
      direction: 'callers',
      depth: 2,
    })) as { items: { name: string }[]; totalCount: number; truncated: boolean };
    expect(callers.items.length).toBeGreaterThan(0);
    expect(callers.items.some((e) => e.name === 'isAuthorized')).toBe(true);
    expect(callers.totalCount).toBe(callers.items.length);
    expect(callers.truncated).toBe(false);

    const truncatedCallers = (await callToolJson(client, 'call_hierarchy', {
      repo: root,
      symbolId: `${ctx.repo.id}:auth/jwt.ts#verifyToken`,
      direction: 'callers',
      depth: 2,
      limit: 1,
    })) as { items: unknown[]; totalCount: number; truncated: boolean };
    expect(truncatedCallers.items).toHaveLength(1);
    expect(truncatedCallers.totalCount).toBeGreaterThan(1);
    expect(truncatedCallers.truncated).toBe(true);

    const usage = (await callToolJson(client, 'component_usage', {
      repo: root,
      componentId: `${ctx.repo.id}:components/UserCard.tsx#UserCard`,
      depth: 3,
    })) as { items: { name: string }[] };
    expect(usage.items.some((e) => e.name === 'UserList')).toBe(true);

    const deps = (await callToolJson(client, 'dependency_graph', { repo: root })) as {
      dependencies: { items: { name: string }[]; totalCount: number };
    };
    expect(deps.dependencies.items.some((d) => d.name === 'react')).toBe(true);

    const dead = (await callToolJson(client, 'dead_code', { repo: root })) as {
      symbols: { items: { name: string; kind: string }[] };
    };
    expect(dead.symbols.items.some((s) => s.name === 'Modal' && s.kind === 'Component')).toBe(true);

    await client.close();
  }, 30_000);

  it('rejects edit_function apply without a prior preview', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'edit_function',
      arguments: { repo: root, apply: true },
    });
    expect(result.isError).toBe(true);

    await client.close();
  });

  it('drives preview -> apply through edit_function, sharing the SQLite journal with REST', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const symbolId = `${ctx.repo.id}:auth/jwt.ts#verifyToken`;
    const preview = (await callToolJson(client, 'edit_function', {
      repo: root,
      operation: 'rename_symbol',
      params: { symbolId, newName: 'verifyJwtMcp' },
    })) as { id: string; status: string; diff: string };
    expect(preview.status).toBe('pending');
    expect(preview.diff).toContain('-export function verifyToken(');

    const applied = (await callToolJson(client, 'edit_function', {
      repo: root,
      editId: preview.id,
      apply: true,
    })) as { status: string };
    expect(applied.status).toBe('applied');

    await client.close();
  }, 30_000);

  it('boots over the real stdio transport (spawns the built binary)', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dirname, '../../dist/main.js')],
    });
    const client = new Client({ name: 'stdio-test-client', version: '0.0.0' });
    await client.connect(transport);

    const summary = (await callToolJson(client, 'repository_summary', { repo: root })) as {
      fileCount: number;
    };
    expect(summary.fileCount).toBeGreaterThan(0);

    await client.close();
  }, 30_000);

  it('boots over the real streamable HTTP transport', async () => {
    const port = 14802;
    await startHttpServer(port);

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${String(port)}/mcp`),
    );
    const client = new Client({ name: 'http-test-client', version: '0.0.0' });
    // Same upstream exactOptionalPropertyTypes typing gap as runtime.ts (the
    // class's `sessionId` accessor is `string | undefined`, the `Transport`
    // interface declares it bare-optional).
    await client.connect(transport as unknown as Transport);

    const hits = await callToolJson(client, 'semantic_search', {
      repo: root,
      query: 'jwt',
      k: 3,
    });
    expect(Array.isArray(hits)).toBe(true);

    await client.close();
  }, 30_000);
});
