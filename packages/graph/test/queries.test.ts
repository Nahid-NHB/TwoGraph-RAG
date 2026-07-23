import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@twograph/core';
import { GraphQueries, QUERY_TEMPLATES, runTemplate } from '@twograph/graph';

const fakeClient = { run: () => Promise.resolve([]) } as never;

describe('GraphQueries guards', () => {
  it('clamps traversal depth to [1,5]', async () => {
    const queries = new GraphQueries(fakeClient);
    await expect(queries.callers('r', 'r:a.ts#f', 0)).rejects.toThrow(ValidationError);
    await expect(queries.callers('r', 'r:a.ts#f', 6)).rejects.toThrow(ValidationError);
    await expect(queries.callees('r', 'r:a.ts#f', 2.5)).rejects.toThrow(ValidationError);
  });

  it('rejects unknown edge types in subgraph filters', async () => {
    const queries = new GraphQueries(fakeClient);
    await expect(queries.subgraph('r', 'r:a.ts#f', ['CALLS; DROP'], 2)).rejects.toThrow();
  });
});

describe('GraphQueries caching (issue #71)', () => {
  it('is off by default — every call reaches the client', async () => {
    const run = vi.fn().mockResolvedValue([]);
    const queries = new GraphQueries({ run } as never);
    await queries.filePaths('r');
    await queries.filePaths('r');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('caches a repeat call with the same args at the same generation', async () => {
    const run = vi.fn().mockResolvedValue([]);
    const queries = new GraphQueries({ run } as never, { getGeneration: () => 1 });
    await queries.filePaths('r');
    await queries.filePaths('r');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not share cached entries across different args', async () => {
    const run = vi.fn().mockResolvedValue([]);
    const queries = new GraphQueries({ run } as never, { getGeneration: () => 1 });
    await queries.callers('r', 'r:a.ts#f', 2);
    await queries.callers('r', 'r:a.ts#g', 2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not share cached entries across repos', async () => {
    const run = vi.fn().mockResolvedValue([]);
    const queries = new GraphQueries({ run } as never, { getGeneration: () => 1 });
    await queries.filePaths('r1');
    await queries.filePaths('r2');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('re-queries once the generation (index version) advances', async () => {
    const run = vi.fn().mockResolvedValue([]);
    let generation = 1;
    const queries = new GraphQueries({ run } as never, { getGeneration: () => generation });
    await queries.filePaths('r');
    generation = 2; // simulates a reindex that changed something
    await queries.filePaths('r');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never caches a thrown NotFoundError', async () => {
    const run = vi.fn().mockResolvedValue([]);
    const queries = new GraphQueries({ run } as never, { getGeneration: () => 1 });
    await expect(queries.symbolDetail('r', 'r:a.ts#missing')).rejects.toThrow();
    await expect(queries.symbolDetail('r', 'r:a.ts#missing')).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('template registry', () => {
  it('rejects unknown templates with the available list', async () => {
    await expect(runTemplate(fakeClient, 'nope', {})).rejects.toThrow(ValidationError);
  });

  it('validates template params', async () => {
    await expect(runTemplate(fakeClient, 'who_calls', { repo: 'r' })).rejects.toThrow();
  });

  it('ships the canonical docs/05 templates', () => {
    expect(Object.keys(QUERY_TEMPLATES)).toEqual(
      expect.arrayContaining([
        'who_calls',
        'files_depending_on',
        'unused_components',
        'context_flow',
        'routes',
      ]),
    );
  });
});
