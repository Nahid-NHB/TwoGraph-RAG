import { describe } from 'vitest';
import { GeminiProvider } from '@twograph/llm';
import { llmProviderConformance } from './conformance.js';

// Real-API smoke test — requires network + a valid key; opt-in only, same
// pattern as the vector package's real-embedder test.
describe.skipIf(!process.env['TWOGRAPH_TEST_REAL_LLM_GEMINI'])('GeminiProvider (real)', () => {
  llmProviderConformance('gemini', () => {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for TWOGRAPH_TEST_REAL_LLM_GEMINI');
    return new GeminiProvider({ apiKey, model: 'gemini-2.5-flash' });
  });
});
