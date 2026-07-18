import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { UsersPage } from './pages/UsersPage';

// Dynamic import — exercises lazy-route extraction and "possibly used" dead-code handling.
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<p>Loading…</p>}>
                <SettingsPage />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
