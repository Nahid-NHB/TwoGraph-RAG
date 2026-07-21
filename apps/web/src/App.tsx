import { Navigate, Route, Routes } from 'react-router-dom';
import { RootLayout } from './routes/root-layout.js';
import { RepoGate } from './routes/repo-gate.js';
import { ChatPage } from './routes/chat.js';
import { Explorer } from './routes/explorer.js';
import { Placeholder } from './routes/placeholder.js';
import { SearchPage } from './routes/search.js';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RepoGate />} />
      <Route path="/:repoId" element={<RootLayout />}>
        <Route index element={<Explorer />} />
        <Route path="blob/*" element={<Explorer />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:sessionId" element={<ChatPage />} />
        <Route path="graph" element={<Placeholder title="Graph" />} />
        <Route path="edits" element={<Placeholder title="Edits" />} />
        <Route path="deps" element={<Placeholder title="Dependencies" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
