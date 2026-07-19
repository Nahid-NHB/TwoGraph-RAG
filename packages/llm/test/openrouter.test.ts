import { describe } from 'vitest';
import { OpenRouterProvider } from '@twograph/llm';
import { llmProviderConformance } from './conformance.js';

// Real-API smoke test — requires network + a valid key; opt-in only, same
// pattern as the vector package's real-embedder test.
describe.skipIf(!process.env['TWOGRAPH_TEST_REAL_LLM_OPENROUTER'])(
  'OpenRouterProvider (real)',
  () => {
    llmProviderConformance('openrouter', () => {
      const apiKey = process.env['OPENROUTER_API_KEY'];
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is required for TWOGRAPH_TEST_REAL_LLM_OPENROUTER');
      }
      return new OpenRouterProvider({ apiKey, model: 'openai/gpt-4o-mini' });
    });
  },
);
