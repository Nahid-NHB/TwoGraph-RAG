import { describe, expect, it } from 'vitest';
import { MockLlmProvider } from '@twograph/llm';
import { llmProviderConformance } from './conformance.js';

llmProviderConformance('mock', () => new MockLlmProvider(['pong']));

describe('MockLlmProvider', () => {
  it('replays fixtures in order', async () => {
    const provider = new MockLlmProvider(['first', 'second']);
    const a = await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    const b = await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(a.content).toBe('first');
    expect(b.content).toBe('second');
  });

  it('loops back to the first fixture by default once exhausted', async () => {
    const provider = new MockLlmProvider(['only']);
    await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    const second = await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(second.content).toBe('only');
  });

  it('throws once exhausted when loop is disabled', async () => {
    const provider = new MockLlmProvider(['only'], { loop: false });
    await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /exhausted/,
    );
  });

  it('accepts structured fixtures with explicit tool calls and finish reason', async () => {
    const provider = new MockLlmProvider([
      {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 't1', name: 'lookup', arguments: { q: 'x' } }],
      },
    ]);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([{ id: 't1', name: 'lookup', arguments: { q: 'x' } }]);
  });

  it('emits tool-call stream events before the done event', async () => {
    const provider = new MockLlmProvider([
      {
        content: 'ok',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 't1', name: 'lookup', arguments: {} }],
      },
    ]);
    const types: string[] = [];
    for await (const event of provider.stream({ messages: [{ role: 'user', content: 'x' }] })) {
      types.push(event.type);
    }
    expect(types.at(-1)).toBe('done');
    expect(types).toContain('tool-call');
  });

  it('records every request it receives', async () => {
    const provider = new MockLlmProvider(['ok']);
    await provider.complete({ messages: [{ role: 'user', content: 'hello' }] });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.messages[0]?.content).toBe('hello');
  });

  it('throws when constructed with no fixtures', async () => {
    const provider = new MockLlmProvider([]);
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /no fixtures/,
    );
  });
});
