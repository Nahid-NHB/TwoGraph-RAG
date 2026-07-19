import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '@twograph/llm';

const OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env['OLLAMA_MODEL'] ?? 'llama3';

async function detectOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Issue #42: Ollama enables fully-local operation, but it's an optional local
// service (not part of docker-compose) — skip cleanly when it isn't running,
// same as this suite skips real-API providers when their keys are absent.
const ollamaAvailable = await detectOllama();

describe.skipIf(!ollamaAvailable)('OllamaProvider (local)', () => {
  it('completes a prompt against a locally running model', async () => {
    const provider = new OllamaProvider({ model: OLLAMA_MODEL, baseUrl: `${OLLAMA_BASE_URL}/v1` });
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Reply with a single short word.' }],
      maxTokens: 20,
    });
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  }, 60_000);

  it('streams text deltas that concatenate to the final content', async () => {
    const provider = new OllamaProvider({ model: OLLAMA_MODEL, baseUrl: `${OLLAMA_BASE_URL}/v1` });
    const deltas: string[] = [];
    let finalContent = '';
    for await (const event of provider.stream({
      messages: [{ role: 'user', content: 'Reply with a single short word.' }],
      maxTokens: 20,
    })) {
      if (event.type === 'text-delta') deltas.push(event.delta);
      if (event.type === 'done') finalContent = event.result.content;
    }
    expect(deltas.join('')).toBe(finalContent);
  }, 60_000);
});
