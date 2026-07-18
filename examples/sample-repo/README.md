# sample-repo

Fixture React + TypeScript app used by TwoGraph-RAG integration tests, demos, and retrieval
evaluation. It is designed to be **feature-dense, not runnable in production**: every construct
the parser must extract (FR-2) appears at least once, and it typechecks (`pnpm typecheck`).

## Construct inventory

| Construct                             | Where                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Functions + JSDoc                     | `auth/jwt.ts` (`verifyToken`, `validateJWT`, `signToken`)                     |
| Arrow functions / local helpers       | `auth/jwt.ts#decodeToken`, `pages/HomePage.tsx`                               |
| Classes, extends, implements          | `auth/authService.ts` (`BaseService` → `AuthService implements IAuthService`) |
| Interfaces / enums / type aliases     | `auth/types.ts` (`User`, `Role`, `AuthState`, `TokenPayload`)                 |
| Imports: named/default/star/dynamic   | throughout; dynamic in `App.tsx` (`lazy(() => import(...))`)                  |
| Barrel re-exports                     | `utils/index.ts`                                                              |
| React components (fn/memo/forwardRef) | `components/` (`UserCard`, `Button` memo, `Modal` forwardRef)                 |
| Props via interface + destructuring   | `components/UserCard.tsx` (`UserCardProps`)                                   |
| Custom hooks                          | `hooks/useUsers.ts`, `hooks/useDebounce.ts`, `auth/useAuth.ts`                |
| Context provider/consumer             | `auth/AuthContext.tsx` + `auth/useAuth.ts`                                    |
| Reducer (useReducer)                  | `auth/authReducer.ts` + `AuthContext.tsx`                                     |
| React Router routes                   | `App.tsx` (`/`, `/users`, `/login`, `/settings` lazy)                         |
| Express API routes + handlers         | `api/server.ts` + `api/handlers.ts`                                           |
| Auth flow for semantic search         | `verifyToken`, `validateJWT`, `authenticateUser`, `AuthService.login`         |
| axios dependency usage                | `api/client.ts`                                                               |
| Test file (TESTS edges)               | `auth/auth.test.ts`                                                           |

## Intentional dead code (dead-code detection ground truth)

- `components/DeadBanner.tsx` — component never rendered
- `hooks/useLegacyTheme.ts` — hook never called
- `auth/authService.ts#legacyLogin` — function never called
- `utils/format.ts#toCsvRow` — helper never called (also re-exported by the barrel — tests
  that re-exported-but-unused symbols are still flagged)

`SettingsPage` is loaded only via dynamic import — reachability analysis must mark it
**possibly used**, not dead.
