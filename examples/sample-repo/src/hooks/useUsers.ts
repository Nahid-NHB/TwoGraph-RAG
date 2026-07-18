import { useEffect, useState } from 'react';
import { fetchUsers } from '../api/users';
import type { User } from '../auth/types';

/** Loads and caches the user directory. */
export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUsers()
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { users, loading, error };
}
