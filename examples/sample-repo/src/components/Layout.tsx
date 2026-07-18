import { Outlet } from 'react-router-dom';
import { Nav } from './Nav';

/** App shell: navigation + routed content. */
export function Layout() {
  return (
    <>
      <Nav />
      <main>
        <Outlet />
      </main>
    </>
  );
}
