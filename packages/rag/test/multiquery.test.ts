import { describe, expect, it } from 'vitest';
import { MockLlmProvider } from '@twograph/llm';
import { detectGraphIntent, generateMultiQuery } from '@twograph/rag';

describe('detectGraphIntent', () => {
  it('detects "who calls X" and routes to the who_calls template', () => {
    expect(detectGraphIntent('who calls verifyToken')).toEqual({
      template: 'who_calls',
      params: { name: 'verifyToken' },
    });
  });

  it('detects "callers of X"', () => {
    expect(detectGraphIntent('callers of validateJWT')).toEqual({
      template: 'who_calls',
      params: { name: 'validateJWT' },
    });
  });

  it('detects "depends on X" and routes to files_depending_on', () => {
    expect(detectGraphIntent('which files depend on lodash')).toEqual({
      template: 'files_depending_on',
      params: { dependency: 'lodash' },
    });
  });

  it('detects "unused Y" style questions (repo-wide, no name needed)', () => {
    expect(detectGraphIntent('what components are unused')).toEqual({
      template: 'unused_components',
      params: {},
    });
    expect(detectGraphIntent('show me dead components')).toEqual({
      template: 'unused_components',
      params: {},
    });
  });

  it('detects context-flow and routes questions', () => {
    expect(detectGraphIntent('show the context flow')?.template).toBe('context_flow');
    expect(detectGraphIntent('list all routes')?.template).toBe('routes');
  });

  it('returns undefined for ordinary semantic questions', () => {
    expect(detectGraphIntent('how do I validate a jwt token')).toBeUndefined();
    expect(detectGraphIntent('explain the authentication flow')).toBeUndefined();
  });
});

describe('generateMultiQuery', () => {
  it('validates structured LLM output and returns the rewrites', async () => {
    const llm = new MockLlmProvider([
      JSON.stringify({ queries: ['verifyToken', 'validate jwt token', 'authenticateUser'] }),
    ]);

    const result = await generateMultiQuery(llm, 'how does authentication work');

    expect(result.usedLlm).toBe(true);
    expect(result.queries).toEqual(['verifyToken', 'validate jwt token', 'authenticateUser']);
    expect(result.graphIntent).toBeUndefined();
  });

  it('attaches a detected graph intent alongside the LLM rewrites', async () => {
    const llm = new MockLlmProvider([
      JSON.stringify({ queries: ['verifyToken callers', 'who invokes verifyToken'] }),
    ]);

    const result = await generateMultiQuery(llm, 'who calls verifyToken');

    expect(result.graphIntent).toEqual({ template: 'who_calls', params: { name: 'verifyToken' } });
    expect(result.queries.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to the original question when the LLM returns invalid JSON', async () => {
    const llm = new MockLlmProvider(['not json at all']);

    const result = await generateMultiQuery(llm, 'how does auth work');

    expect(result.usedLlm).toBe(false);
    expect(result.queries).toEqual(['how does auth work']);
  });

  it('falls back when the JSON is well-formed but fails schema validation', async () => {
    const llm = new MockLlmProvider([JSON.stringify({ queries: ['only one'] })]); // needs >= 2

    const result = await generateMultiQuery(llm, 'how does auth work');

    expect(result.usedLlm).toBe(false);
    expect(result.queries).toEqual(['how does auth work']);
  });

  it('falls back to the original question when the LLM call throws', async () => {
    const failing: Parameters<typeof generateMultiQuery>[0] = {
      id: 'failing',
      complete: () => Promise.reject(new Error('provider unavailable')),
      stream: () => {
        throw new Error('not used');
      },
    };

    const result = await generateMultiQuery(failing, 'how does auth work');

    expect(result.usedLlm).toBe(false);
    expect(result.queries).toEqual(['how does auth work']);
  });

  it('still detects a graph intent even when the LLM call fails', async () => {
    const failing: Parameters<typeof generateMultiQuery>[0] = {
      id: 'failing',
      complete: () => Promise.reject(new Error('provider unavailable')),
      stream: () => {
        throw new Error('not used');
      },
    };

    const result = await generateMultiQuery(failing, 'who calls verifyToken');

    expect(result.usedLlm).toBe(false);
    expect(result.graphIntent).toEqual({ template: 'who_calls', params: { name: 'verifyToken' } });
    expect(result.queries).toEqual(['who calls verifyToken']);
  });

  it('propagates an abort instead of falling back, when the signal is already aborted (issue #47)', async () => {
    const llm = new MockLlmProvider(['should never be reached']);
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateMultiQuery(llm, 'how does auth work', controller.signal),
    ).rejects.toThrow();
  });
});
