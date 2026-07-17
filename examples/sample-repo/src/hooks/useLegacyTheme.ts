import { useState } from 'react';

/** DEAD CODE (intentional): replaced by CSS variables, no component uses it. */
export function useLegacyTheme(): ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  return [theme, toggle];
}
