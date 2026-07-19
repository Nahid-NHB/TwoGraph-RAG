import type { Citation } from '@twograph/core';
import type { LlmProvider } from '@twograph/llm';
import type { ChatMessageRow, MetadataStore } from '@twograph/store';
import {
  runRagPipeline,
  type RagAnswer,
  type RagPipelineDeps,
  type RagPipelineOptions,
} from './pipeline.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
}

/** Last 3 turns by default — enough to resolve most pronoun follow-ups. */
const DEFAULT_HISTORY_LIMIT = 6;

function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    role: row.role,
    content: row.content,
    citations: row.citations_json ? (JSON.parse(row.citations_json) as Citation[]) : [],
  };
}

/** Recent history for a session, oldest first, capped to the last `limit` messages. */
export function loadHistory(
  store: MetadataStore,
  sessionId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): ChatMessage[] {
  return store.listChatMessages(sessionId).slice(-limit).map(toChatMessage);
}

const CONDENSE_SYSTEM_PROMPT = `Given the conversation history and a follow-up question, rewrite the
follow-up as a standalone question that resolves any pronouns or references using the history.
Reply with ONLY the rewritten question — no preamble, no quotes.`;

/**
 * Condenses a follow-up question ("and where is it tested?") into a
 * standalone one using recent history (issue #45), so retrieval and
 * multi-query generation see a self-contained question. Failure-safe: any
 * LLM error or empty output falls back to the original question, unchanged.
 */
export async function condenseFollowUp(
  llm: LlmProvider,
  history: ChatMessage[],
  question: string,
): Promise<string> {
  if (history.length === 0) return question;
  const transcript = history.map((m) => `${m.role}: ${m.content}`).join('\n');
  try {
    const result = await llm.complete({
      messages: [
        { role: 'system', content: CONDENSE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Conversation so far:\n${transcript}\n\nFollow-up question: ${question}`,
        },
      ],
      temperature: 0,
      maxTokens: 100,
    });
    const rewritten = result.content.trim();
    return rewritten.length > 0 ? rewritten : question;
  } catch {
    return question;
  }
}

export interface AskInSessionDeps {
  store: MetadataStore;
  pipeline: RagPipelineDeps;
}

export interface AskInSessionResult extends RagAnswer {
  sessionId: string;
  /** The question actually sent to the pipeline, after follow-up condensation. */
  standaloneQuestion: string;
}

/**
 * Answers a question within a persisted chat session (issue #45): loads
 * recent history, condenses follow-ups into a standalone question, runs the
 * RAG pipeline, then persists both the user's original question and the
 * assistant's grounded answer (with citations) for future turns and reload.
 */
export async function askInSession(
  deps: AskInSessionDeps,
  sessionId: string,
  question: string,
  options: RagPipelineOptions,
): Promise<AskInSessionResult> {
  const history = loadHistory(deps.store, sessionId);
  const standaloneQuestion = await condenseFollowUp(deps.pipeline.llm, history, question);
  const answer = await runRagPipeline(deps.pipeline, standaloneQuestion, options);

  deps.store.addChatMessage(sessionId, 'user', question);
  deps.store.addChatMessage(sessionId, 'assistant', answer.content, answer.citations);

  return { ...answer, sessionId, standaloneQuestion };
}
