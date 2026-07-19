import { describe, expect, it } from 'vitest';
import type { Citation } from '@twograph/core';
import { MetadataStore, openDatabase } from '@twograph/store';

function seededStore(): MetadataStore {
  const db = openDatabase(':memory:');
  const store = new MetadataStore(db);
  store.upsertRepository({ id: 'r', rootPath: '/tmp/r', name: 'r' });
  return store;
}

describe('chat sessions & messages', () => {
  it('creates a session and reloads it by id', () => {
    const store = seededStore();
    const created = store.createChatSession('r', 'first chat');
    expect(created.repo_id).toBe('r');
    expect(created.title).toBe('first chat');

    const reloaded = store.getChatSession(created.id);
    expect(reloaded).toEqual(created);
  });

  it('lists sessions for a repo in creation order', () => {
    const store = seededStore();
    const a = store.createChatSession('r', 'a');
    const b = store.createChatSession('r', 'b');
    expect(store.listChatSessions('r').map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it('persists messages with citations and reloads them in order', () => {
    const store = seededStore();
    const session = store.createChatSession('r');
    const citations: Citation[] = [
      { file: 'auth/jwt.ts', symbolId: 'r:auth/jwt.ts#verifyToken', startLine: 10, endLine: 20 },
    ];

    store.addChatMessage(session.id, 'user', 'how does auth work?');
    store.addChatMessage(session.id, 'assistant', 'It verifies tokens [S1].', citations);

    const messages = store.listChatMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'how does auth work?' });
    expect(messages[0]?.citations_json).toBeNull();
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'It verifies tokens [S1].' });
    expect(JSON.parse(messages[1]?.citations_json ?? '[]')).toEqual(citations);
  });

  it('cascades message deletion when a session is removed', () => {
    const store = seededStore();
    const session = store.createChatSession('r');
    store.addChatMessage(session.id, 'user', 'hello');
    store.db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(session.id);
    expect(store.listChatMessages(session.id)).toEqual([]);
  });

  describe('getOrCreateImplicitSession', () => {
    it('creates a session on first use', () => {
      const store = seededStore();
      const session = store.getOrCreateImplicitSession('r');
      expect(session.repo_id).toBe('r');
      expect(store.listChatSessions('r')).toHaveLength(1);
    });

    it('reuses the same session on subsequent calls', () => {
      const store = seededStore();
      const first = store.getOrCreateImplicitSession('r');
      const second = store.getOrCreateImplicitSession('r');
      expect(second.id).toBe(first.id);
      expect(store.listChatSessions('r')).toHaveLength(1);
    });
  });
});
