import type { Citation } from '@twograph/core';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useChatSession } from '../api/hooks.js';
import { MessageContent } from './MessageContent.js';
import { streamChatMessage } from './sse.js';

interface LocalMessage {
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
}

const STAGE_LABELS: Record<string, string> = {
  multiquery: 'Rewriting query…',
  retrieve: 'Searching code…',
  expand: 'Expanding graph context…',
  fuse: 'Ranking results…',
  rerank: 'Reranking…',
  assemble: 'Assembling context…',
  generate: 'Generating answer…',
};

/** One active chat session (issue #59): streamed tokens, stage progress, citations, cancel/error handling. */
export function Conversation({ repoId, sessionId }: { repoId: string; sessionId: string }) {
  const { data: session } = useChatSession(repoId, sessionId);
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState<string | undefined>();
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const history: LocalMessage[] = (session?.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
    citations: m.citations,
  }));
  const messages = [...history, ...pending];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingContent]);

  async function send(): Promise<void> {
    const question = input.trim();
    if (!question || isStreaming) return;
    setInput('');
    setError(undefined);
    setStage(undefined);
    setStreamingContent('');
    setPending([{ role: 'user', content: question, citations: [] }]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let citations: Citation[] = [];
    let accumulated = '';

    try {
      for await (const event of streamChatMessage(repoId, sessionId, question, controller.signal)) {
        if (event.type === 'stage') setStage(event.stage);
        else if (event.type === 'token') {
          accumulated += event.delta;
          setStreamingContent(accumulated);
        } else if (event.type === 'citations') citations = event.citations;
        else if (event.type === 'error') setError(event.message);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      setIsStreaming(false);
      setStage(undefined);
      setPending((prev) => [
        ...prev,
        ...(accumulated || citations.length > 0
          ? [{ role: 'assistant' as const, content: accumulated, citations }]
          : []),
      ]);
      setStreamingContent('');
      abortRef.current = null;
      await queryClient.invalidateQueries({ queryKey: ['chat', 'session', repoId, sessionId] });
      await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', repoId] });
      setPending([]);
    }
  }

  function cancel(): void {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-sm ${
                m.role === 'user'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800'
              }`}
            >
              {m.role === 'assistant' ? (
                <MessageContent repoId={repoId} content={m.content} citations={m.citations} />
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div>
            <div className="inline-block max-w-[85%] rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
              {streamingContent ? (
                <MessageContent repoId={repoId} content={streamingContent} citations={[]} />
              ) : (
                <span className="flex items-center gap-2 text-slate-400">
                  <Loader2 size={14} className="animate-spin" />
                  {stage ? (STAGE_LABELS[stage] ?? stage) : 'Thinking…'}
                </span>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this codebase…"
          disabled={isStreaming}
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={cancel}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <Square size={14} /> Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
          >
            <Send size={14} /> Send
          </button>
        )}
      </form>
    </div>
  );
}
