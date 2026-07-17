import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/useAuth';
import { Button } from './Button';

/** Login form driving the auth context. */
export function LoginForm() {
  const { state, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void login(email, password);
  };

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <Button type="submit" disabled={state.status === 'authenticating'}>
        Sign in
      </Button>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
    </form>
  );
}
