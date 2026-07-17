import { APP_NAME } from '../utils';

export function HomePage() {
  return (
    <section>
      <h1>{APP_NAAME_SAFE()}</h1>
      <p>Welcome to the sample directory app.</p>
    </section>
  );
}

// Small local helper (non-exported) to exercise local call extraction.
function APP_NAAME_SAFE(): string {
  return APP_NAME;
}
