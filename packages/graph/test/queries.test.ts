import { describe, expect, it } from 'vitest';
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
