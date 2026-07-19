import { describe } from 'vitest';
import { OpenAiProvider } from '@twograph/llm';
import { llmProviderConformance } from './conformance.js';

// Real-API smoke test — requires network + a valid key; opt-in only, same
// pattern as the vector package's real-embedder test.
describe.skipIf(!process.env['TWOGRAPH_TEST_REAL_LLM_OPENAI'])('OpenAiProvider (real)', () => {
  llmProviderConformance('openai', () => {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for TWOGRAPH_TEST_REAL_LLM_OPENAI');
    return new OpenAiProvider({ apiKey, model: 'gpt-4o-mini' });
  });
});
