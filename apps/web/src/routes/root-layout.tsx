import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar.js';

export function RootLayout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
