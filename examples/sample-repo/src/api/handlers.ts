import type { Request, Response } from 'express';
import { signToken, verifyToken } from '../auth/jwt';
import { Role, type User } from '../auth/types';

const USERS: User[] = [
  { id: '1', name: 'Ada Lovelace', email: 'ada@example.com', role: Role.Admin },
  { id: '2', name: 'Grace Hopper', email: 'grace@example.com', role: Role.Member },
];

/** GET /api/users — requires a valid bearer token. */
export function listUsersHandler(req: Request, res: Response): void {
  const auth = req.headers.authorization;
  if (!auth || !isAuthorized(auth)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json(USERS);
}

/** GET /api/users/:id */
export function getUserHandler(req: Request, res: Response): void {
  const user = USERS.find((u) => u.id === req.params['id']);
  if (!user) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(user);
}

/** POST /api/login — issues a token for known users. */
export function loginHandler(req: Request, res: Response): void {
  const { email } = req.body as { email?: string };
  const user = USERS.find((u) => u.email === email);
  if (!user) {
    res.status(401).json({ error: 'bad credentials' });
    return;
  }
  res.json({ user, token: signToken(user.id, user.role) });
}

function isAuthorized(header: string): boolean {
  try {
    verifyToken(header.replace(/^Bearer /, ''));
    return true;
  } catch {
    return false;
  }
}
