import { useState } from 'react';
import { useUsers } from '../hooks/useUsers';
import { useDebounce } from '../hooks/useDebounce';
import { UserCard } from './UserCard';

/** Searchable user directory backed by the useUsers hook. */
export function UserList() {
  const { users, loading, error } = useUsers();
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebounce(filter);

  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">{error}</p>;

  const visible = users.filter((u) => u.name.toLowerCase().includes(debouncedFilter.toLowerCase()));

  return (
    <section>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" />
      {visible.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
    </section>
  );
}
