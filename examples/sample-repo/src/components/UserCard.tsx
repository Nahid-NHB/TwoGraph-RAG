import { formatName } from '../utils';
import type { User } from '../auth/types';

export interface UserCardProps {
  user: User;
  onSelect?: (id: string) => void;
}

/** Displays a single user; props come from a named interface. */
export function UserCard({ user, onSelect }: UserCardProps) {
  return (
    <article onClick={() => onSelect?.(user.id)}>
      <strong>{formatName(user.name)}</strong>
      <span>{user.email}</span>
      <em>{user.role}</em>
    </article>
  );
}
