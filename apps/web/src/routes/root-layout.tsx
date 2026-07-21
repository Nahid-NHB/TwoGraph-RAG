import { useEffect } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar.js';

export function RootLayout() {
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();

  // cmd-k opens search from anywhere in the app (issue #58 acceptance criterion).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (repoId) void navigate(`/${repoId}/search`);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [repoId, navigate]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
