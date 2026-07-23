import { Navigate, Route, Routes } from 'react-router-dom';
import { RootLayout } from './routes/root-layout.js';
import { RepoGate } from './routes/repo-gate.js';
import { ChatPage } from './routes/chat.js';
import { DepsPage } from './routes/deps.js';
import { EditsPage } from './routes/edits.js';
import { Explorer } from './routes/explorer.js';
import { GraphPage } from './routes/graph.js';
import { SearchPage } from './routes/search.js';
import { TreePage } from './routes/tree.js';

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
        <Route path="graph" element={<GraphPage />} />
        <Route path="tree" element={<TreePage />} />
        <Route path="edits" element={<EditsPage />} />
        <Route path="deps" element={<DepsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
