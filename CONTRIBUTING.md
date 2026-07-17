# Contributing to TwoGraph-RAG

## Workflow

1. Every change starts from a **GitHub issue**. One issue = one PR. Don't bundle.
2. Check the issue's **dependencies** section — don't start an issue whose dependencies aren't merged.
3. Branch from `main`: `feat/<issue-number>-short-slug` or `fix/...`.
4. Write tests first or alongside; `pnpm test` must pass locally.
5. Update docs touched by your change (`docs/`, README).
6. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `feat(parser): extract custom hooks (#42)`.
7. Open a PR referencing the issue (`Closes #42`). CI must be green.

## Development setup

```bash
pnpm install
docker compose up -d          # Memgraph :7687, Qdrant :6333
pnpm build                    # tsc project references
pnpm test                     # unit tests (no services needed)
pnpm test:int                 # integration tests (needs docker stack)
pnpm lint && pnpm typecheck
```

## Code standards

- TypeScript `strict: true`; no `any` in exported APIs; zod at all boundaries.
- No package may import from `server`, `mcp`, `cli`, or `apps/*` (enforced by ESLint).
- Unit tests (`*.test.ts`) must not touch network/docker; integration tests are `*.int.test.ts`.
- **Never edit user code with regex** — AST only (see docs/08).
- Errors: throw typed errors from `@twograph/core`; never swallow.

## Releases

Changesets (`pnpm changeset`) on every user-facing change; release PRs are automated.
