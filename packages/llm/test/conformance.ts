import { describe, expect, it } from 'vitest';
import type { CompletionResult, LlmProvider } from '../src/provider.js';

/**
 * Shared conformance suite (issue #41): every provider — real or mock — must
 * satisfy this so swapping providers is a config change, not a code change.
 */
export function llmProviderConformance(name: string, createProvider: () => LlmProvider): void {
  describe(`${name} provider conformance`, () => {
    it('completes a prompt with non-empty content, usage, and a model name', async () => {
      const provider = createProvider();
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Reply with a short greeting.' }],
        maxTokens: 30,
      });
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.usage.totalTokens).toBeGreaterThan(0);
      expect(result.model.length).toBeGreaterThan(0);
      expect(['stop', 'length', 'tool_calls']).toContain(result.finishReason);
    });

    it('streams text deltas that concatenate to the final done content', async () => {
      const provider = createProvider();
      const deltas: string[] = [];
      let done: CompletionResult | undefined;
      for await (const event of provider.stream({
        messages: [{ role: 'user', content: 'Reply with a short greeting.' }],
        maxTokens: 30,
      })) {
        if (event.type === 'text-delta') deltas.push(event.delta);
        if (event.type === 'done') done = event.result;
      }
      expect(done).toBeDefined();
      expect(deltas.join('')).toBe(done?.content);
      expect(done?.usage.totalTokens).toBeGreaterThan(0);
    });

    it('accepts a system message alongside the user message', async () => {
      const provider = createProvider();
      const result = await provider.complete({
        messages: [
          { role: 'system', content: 'You are terse.' },
          { role: 'user', content: 'Reply with a short greeting.' },
        ],
        maxTokens: 30,
      });
      expect(result.content.length).toBeGreaterThan(0);
    });
  });
}
