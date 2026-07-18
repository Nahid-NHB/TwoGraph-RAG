import { fetchJson } from '../api/client';
import { signToken, verifyToken } from './jwt';
import { Role, type IAuthService, type Session, type User } from './types';

/** Base class demonstrating inheritance extraction. */
export abstract class BaseService {
  protected log(message: string): void {
    console.info(`[${this.constructor.name}] ${message}`);
  }
}

/**
 * Authenticates users against the API and manages the active session.
 */
export class AuthService extends BaseService implements IAuthService {
  private session: Session | null = null;

  async login(email: string, password: string): Promise<Session> {
    this.log(`login attempt for ${email}`);
    const user = await authenticateUser(email, password);
    const token = signToken(user.id, user.role);
    this.session = { user, token, expiresAt: Date.now() + 3_600_000 };
    return this.session;
  }

  logout(): void {
    this.session = null;
  }

  /** Returns the current user if the stored token still verifies. */
  currentUser(): User | null {
    if (!this.session) return null;
    try {
      verifyToken(this.session.token);
      return this.session.user;
    } catch {
      this.session = null;
      return null;
    }
  }
}

/** Checks credentials against the backend and returns the matched user. */
export async function authenticateUser(email: string, password: string): Promise<User> {
  const result = await fetchJson<{ user: User }>('/api/login', {
    method: 'POST',
    body: { email, password },
  });
  return result.user;
}

export const defaultAuthService = new AuthService();

/** DEAD CODE (intentional): superseded by AuthService.login, never called. */
export function legacyLogin(email: string): Session {
  return {
    user: { id: 'legacy', name: email, email, role: Role.Guest },
    token: 'legacy',
    expiresAt: 0,
  };
}
