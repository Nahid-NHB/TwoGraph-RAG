# Requirements

## 1. Functional Requirements

### FR-1 Repository Indexing
- **FR-1.1** Index a local repository (path) into the platform; multiple repositories supported.
- **FR-1.2** Respect `.gitignore` plus a configurable ignore list; skip binaries, lockfiles, `node_modules`.
- **FR-1.3** Incremental indexing: only re-process files whose content hash changed.
- **FR-1.4** Filesystem watcher keeps graph + embeddings current without full rebuilds.
- **FR-1.5** Full rebuild only on explicit user request.

### FR-2 Parsing (Tree-sitter)
- **FR-2.1** Languages: JavaScript, TypeScript, JSX, TSX.
- **FR-2.2** Extract: functions, arrow functions, classes, methods, interfaces, enums, type aliases, variables, imports, exports.
- **FR-2.3** React: components (function/class/memo/forwardRef), props (from type/destructuring), hooks (built-in + custom), contexts (create/provide/consume), reducers, JSX component usage.
- **FR-2.4** Routes and API handlers (Next.js file conventions, Express/Fastify route registrations, React Router).
- **FR-2.5** Comments and JSDoc/TSDoc docstrings attached to their symbols.
- **FR-2.6** Every symbol gets a **stable ID** (`repo:relPath#qualifiedName[:kindDiscriminator]`) surviving re-parses.
- **FR-2.7** Language parsers are plugins; new languages can be added without touching the pipeline.

### FR-3 Knowledge Graph (Memgraph)
- **FR-3.1** Persist the node/edge model in [docs/05-graph-schema.md](05-graph-schema.md).
- **FR-3.2** Idempotent upserts (MERGE semantics); re-indexing a file replaces exactly that file's subgraph.
- **FR-3.3** Route nodes are permanent and queryable across reindexes.
- **FR-3.4** Typed query helpers: call hierarchy (up/down), component usage, neighbors, shortest paths, subgraph export.

### FR-4 Semantic Search
- **FR-4.1** UniXcoder embeddings for symbol-level chunks; embedder is pluggable.
- **FR-4.2** Embeddings stored separately from the graph (Qdrant), joined by symbol ID.
- **FR-4.3** Intent search: "authentication" matches `verifyToken`, `login`, `validateJWT` without the literal keyword.
- **FR-4.4** Filters: symbol kind, path glob, language, repository.

### FR-5 Hybrid Retrieval & RAG
- **FR-5.1** Retrievers: BM25 (SQLite FTS5), vector (Qdrant), graph traversal (seed expansion).
- **FR-5.2** Fusion via Reciprocal Rank Fusion; reranking via cross-encoder.
- **FR-5.3** Assembled context includes: code, signature, docstring, caller hierarchy, callee hierarchy, related files.
- **FR-5.4** RAG pipeline: multi-query generation → hybrid search → graph expansion → RRF → rerank → context assembly → LLM.
- **FR-5.5** Answers are grounded: cite files, functions, snippets, and graph paths; refuse when context is insufficient.
- **FR-5.6** Natural-language queries like "Who calls fetchUser()?", "Find unused React components", "Explain this repository".

### FR-6 LLM Providers
- **FR-6.1** One provider interface; implementations for Gemini, OpenAI, Anthropic, Ollama, OpenRouter.
- **FR-6.2** Providers selected via config/env; hot-swappable per request; streaming supported.

### FR-7 AST-based Editing
- **FR-7.1** All edits via AST (ts-morph); regex-based editing is forbidden.
- **FR-7.2** Operations: rename function/component, move function across files, extract function, add/remove parameter, add/remove/organize imports.
- **FR-7.3** Cross-file consistency: call sites, imports, and re-exports updated together.
- **FR-7.4** Every edit produces a unified diff preview; writes require explicit approval; applied edits are journaled and revertible.

### FR-8 Analysis
- **FR-8.1** Dead code: reachability from configured entry points → unused functions, components, hooks, exports, files.
- **FR-8.2** Dependency analysis: package.json, tsconfig, vite/next/webpack/rollup configs, eslint/prettier, pnpm/npm/yarn → dependency graph.
- **FR-8.3** Optimization advisor: React/TS best-practice, performance, a11y, security, maintainability suggestions; honors a user guidelines file (`.twograph/guidelines.md`).

### FR-9 MCP Server
- **FR-9.1** Tools: `query_graph`, `semantic_search`, `edit_function`, `optimize_function`, `dead_code`, `dependency_graph`, `repository_summary`, `call_hierarchy`, `component_usage`.
- **FR-9.2** Editing tools honor the same approval gate as the API.

### FR-10 Interfaces
- **FR-10.1** REST + SSE API server.
- **FR-10.2** CLI: `index`, `watch`, `query`, `search`, `serve`, `mcp`.
- **FR-10.3** Web UI: repository explorer, graph visualization, chat with citations, diff viewer, hybrid search, dependency explorer, call graph, component graph, dark mode.

## 2. Non-functional Requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-1 | Indexing throughput | ≥ 100 files/s parse+extract on mid-size repo (excl. embedding) |
| NFR-2 | Incremental update latency | file save → graph updated < 2 s |
| NFR-3 | Retrieval latency | hybrid search p95 < 500 ms (excl. LLM) |
| NFR-4 | Scale | 10k files / 100k symbols per repo without degradation |
| NFR-5 | Reliability | crash-safe indexing (resumable); idempotent writes |
| NFR-6 | Extensibility | languages, embedders, vector stores, LLMs, retrievers = plugins |
| NFR-7 | Type safety | `strict: true`, no `any` in public APIs |
| NFR-8 | Quality gates | lint, typecheck, unit + integration tests in CI; conventional commits |
| NFR-9 | Security | secrets only via env; edits sandboxed to repo root; no network in parser |
| NFR-10 | DX | one-command dev stack (`docker compose up`), seeded example repo |
| NFR-11 | Observability | structured logs (pino), timing spans per pipeline stage |
| NFR-12 | Portability | Linux/macOS; Node ≥ 22; no GPU required (ONNX CPU) |
