import type { AuthState, Session } from './types';

export type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; session: Session }
  | { type: 'LOGIN_FAILURE'; message: string }
  | { type: 'LOGOUT' };

export const initialAuthState: AuthState = { status: 'anonymous' };

/** Reducer driving the auth state machine (used via useReducer in AuthProvider). */
export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_START':
      return { status: 'authenticating' };
    case 'LOGIN_SUCCESS':
      return { status: 'authenticated', session: action.session };
    case 'LOGIN_FAILURE':
      return { status: 'error', message: action.message };
    case 'LOGOUT':
      return initialAuthState;
  }
}
