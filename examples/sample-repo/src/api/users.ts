import { fetchJson } from './client';
import type { User } from '../auth/types';

/** Loads a single user by id. */
export function fetchUser(id: string): Promise<User> {
  return fetchJson<User>(`/api/users/${id}`);
}

/** Loads the full user directory. */
export function fetchUsers(): Promise<User[]> {
  return fetchJson<User[]>('/api/users');
}

/** Persists profile changes. */
export function updateUser(user: User): Promise<User> {
  return fetchJson<User>(`/api/users/${user.id}`, { method: 'PUT', body: user });
}
