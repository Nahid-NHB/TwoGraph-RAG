# Editing Pipeline

**Invariant: no regex edits, ever.** All modifications go through ts-morph (TypeScript compiler API) so renames, moves, and signature changes are type-aware and cross-file consistent. Tree-sitter reads; ts-morph writes.

## 1. Flow

```
request → validate → plan (AST transform, in-memory) → diff preview → [approval] → atomic write → journal → reindex affected files
```

1. **Validate** — resolve target symbol via graph/store; verify it exists at the recorded span (file hash check → reject stale requests); verify repo is clean enough to edit (configurable).
2. **Plan** — load a scoped ts-morph `Project` (target file + dependents from the graph's `IMPORTS`/`CALLS` edges — not the whole repo, for speed). Apply the operation in memory.
3. **Preview** — emit unified diff across all touched files + summary (`affectedFiles`, `affectedSymbols`). Persist as `edits` row with status `pending`. Nothing on disk changes.
4. **Approval** — required by default (`editing.requireApproval`). Pending edits expire (default 1 h) since file hashes may drift; re-validated against current hashes at approval time — drift ⇒ status `expired`, user re-proposes.
5. **Apply** — write all files via temp-file + rename (atomic per file), store pre-images in the journal for revert. Path-sandboxed to the repo root.
6. **Reindex** — indexer immediately re-processes touched files so graph/embeddings reflect the edit.
7. **Revert** — restores journaled pre-images (only if current hashes match the applied post-images).

## 2. Operations

| Operation | Params | Guarantees |
| --- | --- | --- |
| `rename_symbol` | `{symbolId, newName}` | all references, imports, JSX tags, re-exports updated; string-only occurrences untouched |
| `move_function` | `{symbolId, targetFile}` | declaration moved; imports added/removed at every call site; barrel exports updated |
| `extract_function` | `{file, span, name}` | selected statements → new function; captured variables become parameters; return values inferred |
| `add_parameter` | `{symbolId, name, type, defaultValue?}` | signature + all call sites updated (default value or explicit arg) |
| `remove_parameter` | `{symbolId, paramName}` | rejected if parameter is used in body (unless `force`); call sites pruned |
| `update_imports` | `{file, add?, remove?, organize?}` | dedupe, sort, prune unused |
| `apply_patch` | `{symbolId, newBody}` | LLM-suggested body (from optimizer) parsed & validated before diff |

Every operation returns the same `EditPlan` shape, so new operations plug in via a registry (see [09-extension-points.md](09-extension-points.md)).

## 3. Safety rails

- Diff preview is mandatory; `apply` without an existing preview is rejected (API and MCP).
- Post-transform check: every touched file must parse cleanly; optional `tsc --noEmit` gate (config).
- Concurrent edits to overlapping files are serialized per repo (single writer lock).
- The optimizer (`optimize_function`) only ever *proposes* `apply_patch` edits — same gate as manual edits.
