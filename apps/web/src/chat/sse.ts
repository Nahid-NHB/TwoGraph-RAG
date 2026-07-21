import type { Citation } from '@twograph/core';

export type ChatStreamEvent =
  | { type: 'stage'; stage: string }
  | { type: 'token'; delta: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'done'; usage: unknown; groundedContext: boolean }
  | { type: 'error'; message: string };

/**
 * Streams a chat turn's `stage`/`token`/`citations`/`done`/`error` SSE
 * frames (issue #47's endpoint) as an async generator. Uses raw `fetch`
 * rather than the typed OpenAPI client — that's built for request/response,
 * not a streamed body.
 */
export async function* streamChatMessage(
  repoId: string,
  sessionId: string,
  question: string,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`/v1/repos/${repoId}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat request failed: ${String(res.status)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (raw.startsWith(':')) continue; // heartbeat comment

      const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;

      const type = eventLine.slice('event: '.length);
      const data = JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
      yield { type, ...data } as ChatStreamEvent;
    }
  }
}
