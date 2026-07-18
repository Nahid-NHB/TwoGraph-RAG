import { createContext, useCallback, useMemo, useReducer, type ReactNode } from 'react';
import { defaultAuthService } from './authService';
import { authReducer, initialAuthState, type AuthAction } from './authReducer';
import type { AuthState } from './types';

export interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

/** Provides the auth state machine to the component tree. */
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  const login = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'LOGIN_START' } satisfies AuthAction);
    try {
      const session = await defaultAuthService.login(email, password);
      dispatch({ type: 'LOGIN_SUCCESS', session });
    } catch (err) {
      dispatch({ type: 'LOGIN_FAILURE', message: err instanceof Error ? err.message : 'failed' });
    }
  }, []);

  const logout = useCallback(() => {
    defaultAuthService.logout();
    dispatch({ type: 'LOGOUT' });
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
