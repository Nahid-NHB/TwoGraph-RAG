import { Navigate, Route, Routes } from 'react-router-dom';
import { RootLayout } from './routes/root-layout.js';
import { RepoGate } from './routes/repo-gate.js';
import { Placeholder } from './routes/placeholder.js';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RepoGate />} />
      <Route path="/:repoId" element={<RootLayout />}>
        <Route index element={<Placeholder title="Explorer" />} />
        <Route path="search" element={<Placeholder title="Search" />} />
        <Route path="chat" element={<Placeholder title="Chat" />} />
        <Route path="chat/:sessionId" element={<Placeholder title="Chat" />} />
        <Route path="graph" element={<Placeholder title="Graph" />} />
        <Route path="edits" element={<Placeholder title="Edits" />} />
        <Route path="deps" element={<Placeholder title="Dependencies" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
