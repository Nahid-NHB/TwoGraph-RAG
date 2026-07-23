import { useParams } from 'react-router-dom';
import { ChatSessionList } from '../chat/ChatSessionList.js';
import { Conversation } from '../chat/Conversation.js';

/** Chat page (issue #59): session list + the active conversation, or an empty prompt. */
export function ChatPage() {
  const { repoId, sessionId } = useParams<{ repoId: string; sessionId: string }>();
  if (!repoId) return null;

  return (
    <div className="flex h-full">
      <ChatSessionList repoId={repoId} activeSessionId={sessionId} />
      <div className="min-w-0 flex-1">
        {sessionId ? (
          <Conversation repoId={repoId} sessionId={sessionId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Start a new chat or pick one from the list.
          </div>
        )}
      </div>
    </div>
  );
}
