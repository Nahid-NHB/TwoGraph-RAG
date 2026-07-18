import { NavLink } from 'react-router-dom';
import { APP_NAME } from '../utils';

export function Nav() {
  return (
    <nav>
      <strong>{APP_NAME}</strong>
      <NavLink to="/">Home</NavLink>
      <NavLink to="/users">Users</NavLink>
      <NavLink to="/login">Login</NavLink>
    </nav>
  );
}
