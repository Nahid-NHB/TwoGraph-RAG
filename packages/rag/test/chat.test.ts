import { describe, expect, it } from 'vitest';
import { MockLlmProvider } from '@twograph/llm';
import { condenseFollowUp, type ChatMessage } from '@twograph/rag';

describe('condenseFollowUp', () => {
  it('returns the original question unchanged when there is no history', async () => {
    const llm = new MockLlmProvider(['should never be used']);
    const result = await condenseFollowUp(llm, [], 'where is it tested?');
    expect(result).toBe('where is it tested?');
    expect(llm.requests).toHaveLength(0);
  });

  it('uses the LLM rewrite when history is present', async () => {
    const llm = new MockLlmProvider(['where is verifyToken tested?']);
    const history: ChatMessage[] = [
      { role: 'user', content: 'who calls verifyToken', citations: [] },
      { role: 'assistant', content: 'isAuthorized calls verifyToken [S1].', citations: [] },
    ];

    const result = await condenseFollowUp(llm, history, 'where is it tested?');

    expect(result).toBe('where is verifyToken tested?');
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.messages.some((m) => m.content.includes('who calls verifyToken'))).toBe(
      true,
    );
  });

  it('falls back to the original question when the LLM returns empty output', async () => {
    const llm = new MockLlmProvider(['   ']);
    const history: ChatMessage[] = [{ role: 'user', content: 'hi', citations: [] }];
    const result = await condenseFollowUp(llm, history, 'where is it tested?');
    expect(result).toBe('where is it tested?');
  });

  it('falls back to the original question when the LLM call throws', async () => {
    const failing = {
      id: 'failing',
      complete: () => Promise.reject(new Error('provider unavailable')),
      stream: () => {
        throw new Error('not used');
      },
    };
    const history: ChatMessage[] = [{ role: 'user', content: 'hi', citations: [] }];
    const result = await condenseFollowUp(failing, history, 'where is it tested?');
    expect(result).toBe('where is it tested?');
  });
});
