// Golden questions over examples/sample-repo (docs/07-retrieval-pipeline.md §"golden-question
// set"). Phrasing leans on identifier tokens shared with the target files since retrieval here
// runs against the deterministic MockEmbedder (hashed bag-of-tokens), not a real model — the
// point is a stable, comparable signal for CI regression gating, not semantic-similarity coverage.
export const GOLDEN_SET = [
  {
    question: 'login authenticate verify token session',
    expectedFiles: [
      'auth/authService.ts',
      'auth/jwt.ts',
      'auth/useAuth.ts',
      'auth/AuthContext.tsx',
    ],
  },
  {
    question: 'fetch users directory list profile',
    expectedFiles: ['api/users.ts', 'hooks/useUsers.ts', 'components/UserList.tsx'],
  },
  {
    question: 'debounce filter input value delay',
    expectedFiles: ['hooks/useDebounce.ts'],
  },
  {
    question: 'listUsersHandler bearer authorization unauthorized',
    expectedFiles: ['api/handlers.ts'],
  },
  {
    question: 'button component variant memo click',
    expectedFiles: ['components/Button.tsx'],
  },
  {
    question: 'modal component title children close forwardRef',
    expectedFiles: ['components/Modal.tsx'],
  },
  {
    question: 'format date name display utils',
    expectedFiles: ['utils/format.ts'],
  },
];
