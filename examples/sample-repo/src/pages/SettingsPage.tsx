import { useAuth } from '../auth/useAuth';

/** Lazily loaded via dynamic import in App.tsx. */
export default function SettingsPage() {
  const { state, logout } = useAuth();
  return (
    <section>
      <h1>Settings</h1>
      {state.status === 'authenticated' ? (
        <button onClick={logout}>Sign out {state.session.user.name}</button>
      ) : (
        <p>Sign in to manage settings.</p>
      )}
    </section>
  );
}
