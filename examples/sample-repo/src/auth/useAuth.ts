import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './AuthContext';

/** Accessor hook for the auth context; throws outside an AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
