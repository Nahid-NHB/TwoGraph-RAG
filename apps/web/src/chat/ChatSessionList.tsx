import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatSessions, useCreateChatSession } from '../api/hooks.js';

export function ChatSessionList({
  repoId,
  activeSessionId,
}: {
  repoId: string;
  activeSessionId: string | undefined;
}) {
  const { data: sessions } = useChatSessions(repoId);
  const createSession = useCreateChatSession(repoId);
  const navigate = useNavigate();

  async function newChat(): Promise<void> {
    const session = await createSession.mutateAsync(undefined);
    void navigate(`/${repoId}/chat/${session.id}`);
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800">
      <div className="border-b border-slate-200 p-2 dark:border-slate-800">
        <button
          type="button"
          onClick={() => void newChat()}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          <Plus size={14} /> New chat
        </button>
      </div>
      <ul className="flex-1 overflow-auto">
        {sessions?.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => void navigate(`/${repoId}/chat/${session.id}`)}
              className={`block w-full truncate px-3 py-2 text-left text-sm ${
                session.id === activeSessionId
                  ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
              }`}
            >
              {session.title ?? `Session ${session.id.slice(0, 8)}`}
            </button>
          </li>
        ))}
        {sessions?.length === 0 && (
          <li className="p-3 text-sm text-slate-400">No conversations yet.</li>
        )}
      </ul>
    </div>
  );
}
