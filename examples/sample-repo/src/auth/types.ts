/** Roles a user can hold. */
export enum Role {
  Admin = 'admin',
  Member = 'member',
  Guest = 'guest',
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Session {
  user: User;
  token: string;
  expiresAt: number;
}

export type AuthState =
  | { status: 'anonymous' }
  | { status: 'authenticating' }
  | { status: 'authenticated'; session: Session }
  | { status: 'error'; message: string };

export interface IAuthService {
  login(email: string, password: string): Promise<Session>;
  logout(): void;
}

export type TokenPayload = {
  sub: string;
  role: Role;
  exp: number;
};
