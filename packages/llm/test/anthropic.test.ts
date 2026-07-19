import { describe } from 'vitest';
import { AnthropicProvider } from '@twograph/llm';
import { llmProviderConformance } from './conformance.js';

// Real-API smoke test — requires network + a valid key; opt-in only, same
// pattern as the vector package's real-embedder test.
describe.skipIf(!process.env['TWOGRAPH_TEST_REAL_LLM_ANTHROPIC'])(
  'AnthropicProvider (real)',
  () => {
    llmProviderConformance('anthropic', () => {
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for TWOGRAPH_TEST_REAL_LLM_ANTHROPIC');
      }
      return new AnthropicProvider({ apiKey, model: 'claude-haiku-4-5' });
    });
  },
);
